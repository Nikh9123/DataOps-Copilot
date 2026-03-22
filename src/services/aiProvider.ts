import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import path from "path";

loadEnvironmentVariables();

export type AiChatMessage = {
  role: "system" | "user";
  content: string;
};

export interface AiProvider {
  createChatCompletion(messages: AiChatMessage[], temperature?: number): Promise<string>;
}

type ProviderName = "openai" | "gemini";

type ProviderConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
};

export class AiProviderFactory {
  static fromEnvironment(): AiProvider {
    const config = this.readConfig();

    if (config.provider === "gemini") {
      return new GeminiProvider(config.apiKey, config.model);
    }

    return new OpenAiProvider(config.apiKey, config.model);
  }

  private static readConfig(): ProviderConfig {
    const providerRaw = (process.env.DATAOPS_AI_PROVIDER ?? "openai").trim().toLowerCase();
    const provider: ProviderName = providerRaw === "gemini" ? "gemini" : "openai";

    if (provider === "gemini") {
      const apiKey = process.env.DATAOPS_GEMINI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("Missing DATAOPS_GEMINI_API_KEY environment variable.");
      }

      return {
        provider,
        apiKey,
        model: process.env.DATAOPS_GEMINI_MODEL?.trim() || "gemini-2.0-flash"
      };
    }

    const apiKey = process.env.DATAOPS_OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("Missing DATAOPS_OPENAI_API_KEY environment variable.");
    }

    return {
      provider,
      apiKey,
      model: process.env.DATAOPS_OPENAI_MODEL?.trim() || "gpt-4o-mini"
    };
  }
}

/** Called once from extension activate() with each VS Code workspace folder root. */
export function loadEnvironmentFromWorkspace(workspacePath: string): void {
  const envPath = path.join(workspacePath, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

function loadEnvironmentVariables(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../../.env")
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      return;
    }
  }

  // Keep default behavior if no file was found in known locations.
  dotenv.config({ override: false });
}

class OpenAiProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async createChatCompletion(messages: AiChatMessage[], temperature = 0.2): Promise<string> {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: this.model,
        temperature,
        messages
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 45000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenAI returned an empty response.");
    }

    return content;
  }
}

class GeminiProvider implements AiProvider {
  private readonly ai: GoogleGenAI;

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async createChatCompletion(messages: AiChatMessage[], temperature = 0.2): Promise<string> {
    const configuredModel = this.model.replace(/^models\//i, "").trim();
    const fallbackModels = [configuredModel, "gemini-3-flash-preview", "gemini-2.0-flash", "gemini-1.5-flash"];
    const modelCandidates = Array.from(new Set(fallbackModels.filter(Boolean)));

    const prompt = messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");

    let lastError: unknown = new Error("Gemini request failed.");

    for (const model of modelCandidates) {
      try {
        const response = await this.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature
          }
        });

        const text = response.text;
        if (typeof text === "string" && text.trim()) {
          return text;
        }

        throw new Error(`Gemini returned an empty response for model '${model}'.`);
      } catch (error) {
        lastError = error;

        if (this.isNotFoundError(error)) {
          continue;
        }
      }
    }

    throw this.toGeminiError(lastError);
  }

  private isNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b404\b|not\s*found|model\s*not\s*found/i.test(message);
  }

  private toGeminiError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}
