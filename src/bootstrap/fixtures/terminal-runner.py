"""Bounded PTY driver for local startup validation; no external services."""
import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time
import fcntl
import struct

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 80 if sys.argv[1] == "quit-compact" else 140, 0, 0))
proc = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
started = time.monotonic()
sent = 0
sent_at = 0
output = bytearray()
timed_out = False
try:
    while proc.poll() is None:
        elapsed = time.monotonic() - started
        if elapsed > 9:
            timed_out = True
            os.killpg(proc.pid, signal.SIGKILL)
            break
        if elapsed > 2 and sent == 0 and (not sys.argv[1].startswith("quit") or b"CONVERSATION" in output):
            os.write(master, b"\x04" if sys.argv[1] == "abort" else b"\x03")
            sent = 1
            sent_at = elapsed
        if elapsed - sent_at > 0.2 and sent == 1 and sys.argv[1].startswith("quit") and b"again" in output:
            os.write(master, b"\x03")
            sent = 2
        if select.select([master], [], [], 0.05)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
    code = proc.wait(timeout=2)
finally:
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    os.close(master)
print(json.dumps({"code": code, "timedOut": timed_out, "outputBytes": len(output), "scheduleBarVisible": b"SCHEDULES" in output, "expiredVisible": b"EXPIRED" in output, "tail": output[-1600:].decode("utf8", errors="replace")}))
