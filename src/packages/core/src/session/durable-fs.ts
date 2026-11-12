import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const writeDurable = (path: string, content: string): void => {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  const handle = openSync(path, "r");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
};

export const fsyncDirectory = (path: string): void => {
  const handle = openSync(path, "r");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
};

export const writeAtomic = (path: string, content: string): void => {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    const handle = openSync(temporary, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    rmSync(temporary, { force: true });
  }
};
