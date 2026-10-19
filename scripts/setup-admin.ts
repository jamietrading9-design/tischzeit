import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";

function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: stdin, output: stdout });
  return new Promise((resolveAnswer) => terminal.question(question, (answer) => {
    terminal.close();
    resolveAnswer(answer);
  }));
}

function askSecret(question: string): Promise<string> {
  if (!stdin.isTTY) return Promise.reject(new Error("Bitte führe dieses Kommando in einem interaktiven Terminal aus."));
  return new Promise((resolveAnswer, reject) => {
    stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
    };
    const onData = (buffer: Buffer) => {
      for (const character of buffer.toString()) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Einrichtung abgebrochen."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolveAnswer(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && character <= "~") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const envPath = resolve(process.cwd(), ".env");
  const enteredUsername = (await ask("Benutzername [jamie]: ")).trim();
  const username = enteredUsername || "jamie";
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    throw new Error("Der Benutzername muss 3 bis 64 Zeichen lang sein und darf nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten.");
  }
  const password = await askSecret("Passwort (mindestens 12 Zeichen): ");
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
    throw new Error("Das Passwort muss mindestens 12 Zeichen und höchstens 128 Bytes lang sein.");
  }
  const confirmation = await askSecret("Passwort wiederholen: ");
  if (password !== confirmation) throw new Error("Die Passwörter stimmen nicht überein.");

  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  const values = {
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD_HASH: `${salt.toString("hex")}:${hash.toString("hex")}`,
  };
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  const found = new Set<keyof typeof values>();
  const updatedLines = lines.map((line) => {
    const match = /^\s*(?:export\s+)?(ADMIN_USERNAME|ADMIN_PASSWORD_HASH)\s*=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (key !== "ADMIN_USERNAME" && key !== "ADMIN_PASSWORD_HASH") return line;
    found.add(key);
    return `${key}=${values[key]}`;
  });
  const keys: Array<keyof typeof values> = ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH"];
  for (const key of keys) {
    if (!found.has(key)) updatedLines.push(`${key}=${values[key]}`);
  }
  const tempPath = `${envPath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, `${updatedLines.join("\n")}\n`, { mode: 0o600, flag: "wx" });
    renameSync(tempPath, envPath);
    chmodSync(envPath, 0o600);
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
  console.log("Admin-Zugang sicher in .env eingerichtet. Die Datei ist von Git ausgeschlossen.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
