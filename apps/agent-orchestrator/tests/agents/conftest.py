"""conftest.py — adds src/ to sys.path so agent imports resolve correctly."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))
