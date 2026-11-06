"""Drive the startup menu and application handoff in a real, bounded PTY."""
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

steps = json.loads(sys.argv[1])
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 28, 80, 0, 0))
original = termios.tcgetattr(slave)
proc = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
output = bytearray()
checkpoint = 0
index = 0
deadline = time.monotonic() + 15
failure = None
try:
    while proc.poll() is None:
        if time.monotonic() > deadline:
            raise RuntimeError("Timed out on step " + str(index))
        if select.select([master], [], [], 0.02)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
        if index < len(steps) and steps[index]["wait"].encode() in output[checkpoint:] and ("waitFile" not in steps[index] or os.path.exists(steps[index]["waitFile"])):
            step = steps[index]
            if "absent" in step and os.path.exists(step["absent"]):
                raise RuntimeError("Unexpected history before successful launch")
            checkpoint = len(output)
            if step.get("delay"):
                time.sleep(step["delay"])
            if step.get("keyDelay"):
                for key in re.findall(r"\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]", step["send"]):
                    os.write(master, key.encode())
                    time.sleep(step["keyDelay"])
            else:
                os.write(master, step["send"].encode())
            if step.get("signal"):
                os.killpg(proc.pid, getattr(signal, step["signal"]))
            index += 1
    proc.wait(timeout=2)
except Exception as error:
    failure = str(error)
finally:
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    restored = termios.tcgetattr(slave) == original
    os.close(slave)
    os.close(master)
plain_output = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output.decode("utf8", errors="replace"))
print(json.dumps({"code": proc.returncode, "steps": index, "expectedSteps": len(steps),
                  "restored": restored, "failure": failure,
                  "commands": re.findall(r"执行命令: ([^\r\n]*)", plain_output),
                  "tail": plain_output[-4000:]}))
