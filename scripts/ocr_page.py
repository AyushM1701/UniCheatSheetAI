"""Offline OCR worker for one rendered PDF page. Prints exactly one JSON object."""
import json
import os
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def quality(text):
    value = text.strip()
    if not value:
        return 0.0
    readable = sum(char.isalnum() or char.isspace() or char in ".,:;!?()[]{}+-=/\\%&@#$^*'\"_" for char in value) / len(value)
    words = [word for word in value.split() if any(char.isalpha() for char in word)]
    plausible = sum(len(word) <= 24 for word in words) / max(len(words), 1)
    return readable * 0.4 + plausible * 0.3 + min(len(value) / 80, 1) * 0.3


def preprocess(source):
    image = Image.open(source).convert("RGB")
    grayscale = ImageOps.grayscale(image)
    grayscale = ImageOps.autocontrast(grayscale)
    grayscale = ImageEnhance.Contrast(grayscale).enhance(1.25)
    return grayscale.filter(ImageFilter.MedianFilter(3))


def tesseract(image):
    binary = os.environ.get("OCR_BINARY", "tesseract")
    language = os.environ.get("OCR_LANG", "eng")
    descriptor, path = tempfile.mkstemp(suffix=".png")
    os.close(descriptor)
    try:
        image.save(path)
        table = subprocess.run([binary, path, "stdout", "-l", language, "tsv"], capture_output=True, text=True, timeout=120, check=True)
    finally:
        os.unlink(path)
    scores = []
    lines = []
    previous_line = None
    for row in table.stdout.splitlines()[1:]:
        fields = row.split("\t")
        if len(fields) >= 12 and fields[11].strip():
            if fields[0] == "5":
                line_key = tuple(fields[1:5])
                if line_key != previous_line:
                    lines.append(fields[11].strip())
                    previous_line = line_key
                else:
                    lines[-1] += " " + fields[11].strip()
            try:
                score = float(fields[10])
                if score >= 0:
                    scores.append(score)
            except ValueError:
                pass
    return {"method": "tesseract", "text": "\n".join(lines), "confidence": sum(scores) / len(scores) / 100 if scores else None}


def paddle(image):
    from paddleocr import PaddleOCR
    import numpy as np

    with redirect_stdout(sys.stderr):
        engine = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, lang="en")
        output = engine.predict(np.array(image.convert("RGB")))
    lines = []
    for item in output:
        data = item.json["res"]
        for text, score, box in zip(data.get("rec_texts", []), data.get("rec_scores", []), data.get("rec_boxes", [])):
            lines.append((int(box[1]), int(box[0]), text, float(score)))
    lines.sort(key=lambda item: (item[0], item[1]))
    return {"method": "paddleocr", "text": "\n".join(line[2] for line in lines), "confidence": sum(line[3] for line in lines) / len(lines) if lines else None, "lines": len(lines)}


def line_crops(image):
    import numpy as np

    pixels = np.array(image)
    width, height = image.size
    # Ignore the photographed page's dark side borders before projecting ink rows.
    left, right = int(width * 0.07), int(width * 0.93)
    content = pixels[:, left:right]
    threshold = min(210, int(np.percentile(content, 15)) - 25)
    ink = content < threshold
    row_counts = ink.sum(axis=1)
    active = row_counts > max(5, (right - left) * 0.004)
    spans = []
    start = None
    for index, present in enumerate(active):
        if present and start is None:
            start = index
        elif not present and start is not None:
            if index - start >= 12:
                spans.append((start, index))
            start = None
    if start is not None and height - start >= 12:
        spans.append((start, height))
    boxes = []
    for top, bottom in spans:
        columns = np.where(ink[top:bottom].sum(axis=0) > 2)[0]
        if columns.size and columns[-1] - columns[0] >= width * 0.07:
            boxes.append((left + int(columns[0]), top, left + int(columns[-1]) + 1, bottom))
    # TrOCR was trained on text lines. Reject pages that cannot be segmented safely.
    if not 2 <= len(boxes) <= 120:
        return []
    margin = max(5, width // 200)
    return [image.crop((max(0, x1 - margin), max(0, y1 - margin), min(width, x2 + margin), min(height, y2 + margin))).convert("RGB") for x1, y1, x2, y2 in boxes]


def trocr(image):
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    import torch

    crops = line_crops(image)
    if not crops:
        return {"method": "trocr", "text": "", "lines": 0}
    model_name = os.environ.get("OCR_TROCR_MODEL", "microsoft/trocr-base-handwritten")
    processor = TrOCRProcessor.from_pretrained(model_name)
    model = VisionEncoderDecoderModel.from_pretrained(model_name)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device).eval()
    lines = []
    with torch.inference_mode():
        for crop in crops:
            pixels = processor(images=crop, return_tensors="pt").pixel_values.to(device)
            ids = model.generate(pixels, max_new_tokens=128)
            lines.append(processor.batch_decode(ids, skip_special_tokens=True)[0].strip())
    return {"method": "trocr", "text": "\n".join(line for line in lines if line), "lines": len(lines)}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: ocr_page.py PAGE.png")
    source = sys.argv[1]
    image = preprocess(source)
    result = tesseract(image)
    if quality(result["text"]) < 0.73 and os.environ.get("OCR_PADDLE_ENABLED") == "true":
        try:
            candidate = paddle(image)
            if quality(candidate["text"]) > quality(result["text"]) + 0.08:
                result = candidate
        except (ImportError, RuntimeError, ValueError):
            pass
    if os.environ.get("OCR_HANDWRITING_ENABLED") == "true":
        candidate = trocr(image)
        weak_tesseract = result["method"] == "tesseract" and (result.get("confidence") or 0) < 0.65
        if quality(candidate["text"]) > quality(result["text"]) + 0.08 or (weak_tesseract and len(candidate["text"]) > 30 and quality(candidate["text"]) >= quality(result["text"]) - 0.1):
            result = candidate
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
