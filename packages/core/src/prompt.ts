import promptXml from "./prompt.xml" with { type: "text" }

export async function loadSystemPrompt(): Promise<string> {
    return promptXml
}
