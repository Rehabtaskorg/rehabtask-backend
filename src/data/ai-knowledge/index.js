import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const SECTIONS = ["general", "patients", "therapists", "agencies", "support"];

const read = (name) => {
    const content = readFileSync(join(HERE, `${name}.md`), "utf8").trim();
    if (!content) throw new Error(`AI knowledge section "${name}.md" is empty`);
    return content;
};

export const KNOWLEDGE_SECTIONS = Object.freeze(
    Object.fromEntries(SECTIONS.map((name) => [name, read(name)]))
);

export const KNOWLEDGE_BASE = SECTIONS.map((name) => KNOWLEDGE_SECTIONS[name]).join("\n\n---\n\n");
