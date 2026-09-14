"""A resumable log reader for transient Docker Desktop bind-mount failures."""
import os


class LogTail:
    def __init__(self, path, report=print, opener=open):
        self.path, self.report, self.opener = path, report, opener
        self.stream = None
        self.identity = None
        self.offset = None
        self.error = None

    def close(self):
        if self.stream is not None:
            try:
                self.stream.close()
            except OSError:
                pass
            self.stream = None

    def _open(self):
        self.stream = self.opener(self.path, 'rb')
        stat = os.fstat(self.stream.fileno())
        identity = (stat.st_dev, stat.st_ino)
        if self.identity == identity and self.offset is not None and stat.st_size >= self.offset:
            self.stream.seek(self.offset)
        else:
            # Startup/rotation never replays historical chat or trade requests.
            self.stream.seek(0, 2)
        self.identity, self.offset = identity, self.stream.tell()

    def readline(self):
        try:
            if self.stream is None:
                self._open()
            line = self.stream.readline()
            if line and line.endswith(b'\n'):
                self.offset = self.stream.tell()
                result = line.decode('utf-8', errors='replace')
            else:
                # An append can split a UTF-8 character or a complete message.
                # No caller sees it until the line terminator has arrived.
                self.stream.seek(self.offset)
                current = os.stat(self.path)
                if ((current.st_dev, current.st_ino) != self.identity
                        or current.st_size < self.offset):
                    self.close()
                    self._open()
                result = ''
            if self.error is not None:
                self.report('[npc] log reading recovered; previous chat is not replayed')
                self.error = None
            return result
        except OSError as error:
            self.close()
            if isinstance(error, FileNotFoundError):
                # The old path is definitively gone. A newly created file can
                # reuse the same inode, especially on container filesystems.
                self.identity = None
                self.offset = None
            code = (type(error).__name__, error.errno)
            if self.error != code:
                self.report('[npc] log temporarily unavailable: %s errno=%s' % code)
                self.error = code
            # The existing NPC loop continues maintenance while the next
            # bounded poll reopens this same file at its last delivered offset.
            return ''
