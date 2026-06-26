"""Application layer: use cases orchestrating the domain.

This layer defines the *ports* (repository interfaces) that infrastructure
must implement, and the *use cases* that the API / CLI call into. It
depends on the domain but never on SQLAlchemy or FastAPI.
"""
