"""Keep established connections during a bounded transient probe outage.

Callers may retain the dependency only for a network timeout/disconnection.
Authentication, ownership, invalid data and changed releases never use this.
"""
class ProbeGrace:
    def __init__(self, seconds=30):
        self.seconds = seconds
        self.last_success = None
        self.failures = 0

    def success(self, now):
        self.last_success = now
        self.failures = 0

    def transient(self, now):
        self.failures += 1
        return self.last_success is not None and 0 <= now-self.last_success < self.seconds

    def reset(self):
        self.last_success = None
        self.failures = 0
