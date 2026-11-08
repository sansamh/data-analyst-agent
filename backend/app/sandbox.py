"""Subprocess-based Python execution sandbox for the agent."""

import subprocess
import sys
from pathlib import Path

from app.config import settings


def execute_python(code: str, workdir: Path, timeout: int | None = None) -> dict:
    """Run Python code in a subprocess with the given working directory.

    Returns stdout/stderr and the list of files the code created (charts, exports).
    """
    workdir = workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    script = workdir / "_sandbox_script.py"
    prelude = (
        "import matplotlib\n"
        "matplotlib.use('Agg')\n"
        "import matplotlib.pyplot as plt\n"
        "plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', "
        "'Noto Sans CJK SC', 'WenQuanYi Zen Hei', 'DejaVu Sans']\n"
        "plt.rcParams['axes.unicode_minus'] = False\n"
    )
    script.write_text(prelude + code, encoding="utf-8")

    files_before = {p.name for p in workdir.iterdir() if p.name != "_sandbox_script.py"}

    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=workdir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout or settings.code_timeout_seconds,
        env={
            "MPLBACKEND": "Agg",
            "PYTHONIOENCODING": "utf-8",
            "PATH": "/usr/local/bin:/usr/bin:/bin:C:\\app\\python:C:\\app\\python\\Scripts:C:\\Windows\\System32",
        },
    )

    files_after = {p.name for p in workdir.iterdir() if p.is_file()}
    created = sorted(files_after - files_before - {"_sandbox_script.py"})

    return {
        "exit_code": proc.returncode,
        "stdout": proc.stdout[-8000:],
        "stderr": proc.stderr[-4000:],
        "files_created": created,
    }
