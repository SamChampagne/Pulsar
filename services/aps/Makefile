.PHONY: install install-dev test test-unit test-slow test-integration test-real-stack lint format run schedule seed migrate migrate-docker stack-up stack-down up down ui-install ui-dev ui-build clean pilot-up pilot-down pilot-logs pilot-restart

PYTHON ?= python
DOCKER_COMPOSE ?= docker compose -f docker/docker-compose.yml
PILOT_COMPOSE ?= docker compose -f docker/docker-compose.pilot.yml --env-file .env.pilot
STACK_SEED_DATASET ?= industrial
STACK_SEED_RESET ?= true

install:
	$(PYTHON) -m pip install -e .

install-dev:
	$(PYTHON) -m pip install -e ".[dev]"

test:
	$(PYTHON) -m pytest -v

test-unit:
	$(PYTHON) -m pytest tests/unit -v

# V1.2 P3.1b residual — industrial-scale perf gates (5000-op greedy +
# CP-SAT) live behind the slow marker and are EXCLUDED from the default
# unit lane (pyproject.toml addopts). Run them explicitly via this
# target or directly with ``pytest -m slow``.
test-slow:
	$(PYTHON) -m pytest tests/unit -m slow -v

test-integration:
	$(PYTHON) -m pytest tests/integration -v

test-real-stack:
	$(PYTHON) -m pytest tests/integration/test_real_stack_postgres.py -v

lint:
	ruff check planiadvance_v2 tests

format:
	ruff format planiadvance_v2 tests

run:
	uvicorn planiadvance_v2.api.main:app --host 0.0.0.0 --port 8000 --reload

schedule:
	$(PYTHON) -m planiadvance_v2.cli schedule --demo

seed:
	$(PYTHON) -m planiadvance_v2.cli seed

migrate:
	$(PYTHON) -m alembic upgrade head

migrate-docker:
	$(DOCKER_COMPOSE) run --rm --build migrate

stack-up:
	$(DOCKER_COMPOSE) up --build -d postgres
	$(DOCKER_COMPOSE) run --rm --build migrate
	$(DOCKER_COMPOSE) run --rm --build -e SEED_DATASET=$(STACK_SEED_DATASET) -e SEED_RESET=$(STACK_SEED_RESET) seed
	$(DOCKER_COMPOSE) up --build -d api integration-worker

stack-down:
	$(DOCKER_COMPOSE) down

ui-install:
	cd ui && npm install

ui-dev:
	cd ui && npm run dev

ui-build:
	cd ui && npm run build

up:
	$(MAKE) stack-up

down:
	$(DOCKER_COMPOSE) down -v --remove-orphans

clean:
	rm -rf __pycache__ .pytest_cache .mypy_cache .ruff_cache build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} +

# ---------- Pilot bundle (single-host customer install) ----------
# Usage:
#   cp .env.example.pilot .env.pilot && edit .env.pilot
#   make pilot-up
#   open http://<host>:80/
# See docs/README-PILOTE.md for the full operator guide.

pilot-up:
	@test -f .env.pilot || (echo "ERROR: .env.pilot is missing. Copy .env.example.pilot and edit it." && exit 1)
	$(PILOT_COMPOSE) up --build -d postgres
	$(PILOT_COMPOSE) run --rm --build migrate
	$(PILOT_COMPOSE) run --rm --build bootstrap
	$(PILOT_COMPOSE) up --build -d api ui integration-worker

pilot-down:
	$(PILOT_COMPOSE) down

pilot-logs:
	$(PILOT_COMPOSE) logs -f --tail=100

pilot-restart:
	$(PILOT_COMPOSE) restart api ui integration-worker
