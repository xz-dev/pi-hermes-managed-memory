import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
export function readText(path: string): string | undefined {
	try { return readFileSync(path, "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
export function appendLine(path: string, line: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const fd = openSync(path, "a", 0o600);
	try { writeFileSync(fd, line, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
	const directory = openSync(dirname(path), "r");
	try { fsyncSync(directory); } finally { closeSync(directory); }
}
export function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${randomUUID()}.pending`);
	try {
		const fd = openSync(temporary, "wx", 0o600);
		try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
		renameSync(temporary, path);
		const directory = openSync(dirname(path), "r");
		try { fsyncSync(directory); } finally { closeSync(directory); }
	} finally {
		try { unlinkSync(temporary); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
/** A crashed owner leaves a lock: fail closed rather than guessing its request was free. */
export function withLock<T>(path: string, run: () => T): T {
	mkdirSync(dirname(path), { recursive: true });
	try { mkdirSync(path); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`State locked: ${path}`);
		throw error;
	}
	try { return run(); } finally { rmdirSync(path); }
}
