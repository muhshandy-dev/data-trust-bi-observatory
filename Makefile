.PHONY: install lint fmt test check
install:
	python -m venv .venv && .venv/bin/pip install -e ".[dev]"
lint:
	.venv/bin/ruff check . && .venv/bin/ruff format --check .
fmt:
	.venv/bin/ruff check --fix . && .venv/bin/ruff format .
test:
	.venv/bin/pytest --cov=data_trust --cov-report=term-missing
check: lint test
