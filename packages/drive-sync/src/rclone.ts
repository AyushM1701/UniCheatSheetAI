import { spawn } from 'node:child_process';

export async function runRclone(args: string[], binary = process.env.RCLONE_BINARY ?? 'rclone'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const maxOutput = 50 * 1024 * 1024;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > maxOutput) child.kill(); });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; if (stderr.length > maxOutput) child.kill(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`rclone exited ${code}: ${stderr.trim().slice(0, 1000)}`)));
  });
}
