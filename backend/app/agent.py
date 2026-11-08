"""Deep agent construction: planning + filesystem + code execution tools."""

from pathlib import Path

from deepagents import create_deep_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from app.config import settings
from app.sandbox import execute_python as run_python_code

SYSTEM_PROMPT = """You are DataSage, an expert data analyst agent.

Workspace: the uploaded dataset and your working directory are one and the same. \
You have the execute_python tool; pandas, matplotlib and openpyxl are installed \
(matplotlib is preconfigured with the Agg backend - do NOT call plt.show()).

Workflow:
1. Inspect the dataset first: shape, column dtypes, head, missing values.
2. Decide on 3-6 analyses that best answer the user's question, then compute them \
with execute_python. Always print computed results with print().
3. Create 2-4 clear charts (.png, with titles and axis labels, font size >= 11).
4. Write the final report in Markdown, in the SAME LANGUAGE as the user's question:
   - Start with the key findings (exact computed numbers, not vague statements).
   - Then detailed sections for each analysis.
   - Embed every chart with image syntax using the exact saved file name: ![title](chart.png)
   - End with caveats / data-quality limitations.

Rules:
- Never invent numbers - every figure in the report must come from executed code output.
- Use AT MOST 4 execute_python calls total: (1) inspection, (2-3) analysis computation \
and charts, then STOP and write the final report. Batch multiple analyses into one call.
- If code errors, read the traceback, fix it and retry.
- Keep each execute_python call focused; print intermediate results so you can reference them.
"""


def build_agent(workdir: Path, dataset_desc: str, question: str):
    """Build a deep agent bound to one analysis run."""

    @tool
    def execute_python(code: str) -> str:
        """Execute Python code in the workspace directory. pandas, matplotlib and
        openpyxl are available. The dataset file is in the current working directory.
        print() outputs are captured and returned. Newly created files (charts,
        exports) are reported as files_created - save charts with plt.savefig("name.png").
        """
        result = run_python_code(code, workdir)
        parts = [f"exit_code: {result['exit_code']}"]
        if result["stdout"].strip():
            parts.append(f"stdout:\n{result['stdout']}")
        if result["stderr"].strip():
            parts.append(f"stderr:\n{result['stderr']}")
        if result["files_created"]:
            parts.append(f"files_created: {result['files_created']}")
        return "\n".join(parts)

    llm = ChatOpenAI(
        model=settings.llm_model,
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
        temperature=0.2,
        timeout=180,
        max_retries=2,
    )

    user_message = f"{dataset_desc}\n\nAnalysis request: {question}"

    return create_deep_agent(
        model=llm,
        tools=[execute_python],
        system_prompt=SYSTEM_PROMPT,
    ), user_message
