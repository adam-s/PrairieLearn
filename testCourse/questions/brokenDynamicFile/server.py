def file(data):
    # Intentionally raise during dynamic file generation to reproduce issue #805.
    raise RuntimeError("intentional file() failure for issue 805 repro")
