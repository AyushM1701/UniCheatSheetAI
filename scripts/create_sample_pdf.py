from pathlib import Path

pages = [
    [
        "DBMS Normalization - Sample Notes",
        "Normalization organizes relational tables to reduce redundancy and update anomalies.",
        "First Normal Form (1NF): each column contains atomic values and rows are unique.",
        "Second Normal Form (2NF): a table in 1NF has no partial dependency on a composite key.",
        "Third Normal Form (3NF): a table in 2NF has no transitive dependency of a non-key attribute.",
    ],
    [
        "Normalization Worked Example",
        "Consider Enrollment(student_id, course_id, student_name, course_name, grade).",
        "The composite key is (student_id, course_id). Student_name depends only on student_id.",
        "Course_name depends only on course_id. Split into Student, Course, and Enrollment tables.",
        "The split removes partial dependencies and avoids repeating names in every enrollment row.",
    ],
    [
        "Functional Dependencies",
        "A functional dependency X determines Y means each value of X is associated with one value of Y.",
        "For example student_id determines student_name in a Student relation.",
        "A candidate key is a minimal set of attributes that functionally determines all attributes.",
        "Partial dependencies and transitive dependencies help identify violations of normal forms.",
    ],
    [
        "SQL Joins",
        "An INNER JOIN returns rows with matching keys in both tables.",
        "A LEFT JOIN returns all rows from the left table plus matched rows from the right table.",
        "A RIGHT JOIN returns all rows from the right table plus matched rows from the left table.",
        "Use an ON clause to state the join condition, such as Student.id = Enrollment.student_id.",
    ],
]

objects = []
def add(data):
    objects.append(data.encode("ascii"))
    return len(objects)

catalog = add("<< /Type /Catalog /Pages 2 0 R >>")
page_refs = " ".join(f"{4 + i * 2} 0 R" for i in range(len(pages)))
pages_id = add(f"<< /Type /Pages /Kids [{page_refs}] /Count {len(pages)} >>")
font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
for i, lines in enumerate(pages):
    page_id = 4 + i * 2
    content_id = page_id + 1
    add(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>")
    operations = ["BT /F1 12 Tf 50 740 Td 16 TL"]
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        operations.append(f"({safe}) Tj T*")
    operations.append("ET")
    stream = "\n".join(operations).encode("ascii")
    add(f"<< /Length {len(stream)} >>\nstream\n" + stream.decode("ascii") + "\nendstream")

pdf = bytearray(b"%PDF-1.4\n")
offsets = [0]
for index, item in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{index} 0 obj\n".encode())
    pdf.extend(item)
    pdf.extend(b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode())
pdf.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
destination = Path(__file__).resolve().parents[1] / "data" / "samples" / "dbms-normalization.pdf"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_bytes(pdf)
print(destination)
