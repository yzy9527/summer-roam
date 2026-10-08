"""Build the shared animal rig; see docs/animal-development.md."""
import runpy,sys
from pathlib import Path
sys.argv=[sys.argv[0],"--",Path(__file__).resolve().parent.name]
runpy.run_path(str(Path(__file__).resolve().parents[1]/"animals/rig.py"),run_name="__main__")
