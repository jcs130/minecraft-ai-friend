"""Start the explicit native agent-mc trial through the existing bounded process supervisor.

This reuses its private-key loader and watchdog; it does not start Neko or QwenPaw.
"""
from start_neko_trial import main

if __name__ == '__main__':
    main()
