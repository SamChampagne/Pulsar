"""Non-interactive OAuth entry point. Production runner chooses the catalog command."""
import sys
from pathlib import Path
from importlib.metadata import version

if version('hermes-agent') != '0.16.0':
    raise RuntimeError('Runtime needs qualification')
if sys.argv[1:] not in [['login'], ['auth', 'add', 'openai-codex']]:
    raise RuntimeError('Unsupported login command')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'hermes-agent'))
import hermes_cli.env_loader
hermes_cli.env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
from hermes_cli.main import main
main()
