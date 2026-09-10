export type RequirementPriority =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type RequirementStatus =
  | "needs_clarification"
  | "ready";

export interface RawClientRequest {
  id: string;
  clientId: string;
  input: string;
  createdAt: string;
}

export interface StructuredRequirement {
  id: string;
  clientId: string;
  rawInput: string;
  objective: string;
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  priority: RequirementPriority;
  clarificationQuestions: string[];
  status: RequirementStatus;
  createdAt: string;
}

export class RequirementUnderstandingService {
  private readonly requirements = new Map<
    string,
    StructuredRequirement
  >();

  create(request: RawClientRequest): StructuredRequirement {
    if (!request.id.trim()) {
      throw new Error("Requirement ID is required");
    }

    if (!request.clientId.trim()) {
      throw new Error("Client ID is required");
    }

    if (!request.input.trim()) {
      throw new Error("Client request input is required");
    }

    if (this.requirements.has(request.id)) {
      throw new Error(`Requirement already exists: ${request.id}`);
    }

    const rawInput = request.input;
    const normalizedInput = request.input.trim();
    const sections = this.extractSections(normalizedInput);
    const objective = this.extractObjective(normalizedInput, sections);
    const hasLabeledSections = sections.firstSectionIndex !== undefined;
    const requirements =
      sections.requirements.length > 0
        ? sections.requirements
        : hasLabeledSections
          ? []
          : [normalizedInput];
    const constraints = sections.constraints;
    const deliverables =
      sections.deliverables.length > 0
        ? sections.deliverables
        : hasLabeledSections
          ? []
          : this.inferDeliverables(objective);
    const acceptanceCriteria = sections.acceptanceCriteria;
    const clarificationQuestions = this.getClarificationQuestions({
      requirements,
      constraints,
      deliverables,
      acceptanceCriteria,
    });

    const structured: StructuredRequirement = {
      id: request.id,
      clientId: request.clientId,
      rawInput: request.input,
      objective,
      requirements,
      constraints,
      deliverables,
      acceptanceCriteria,
      priority: this.extractPriority(normalizedInput),
      clarificationQuestions,
      status:
        clarificationQuestions.length === 0
          ? "ready"
          : "needs_clarification",
      createdAt: request.createdAt,
    };

    this.requirements.set(structured.id, structured);

    return structured;
  }

  get(requirementId: string): StructuredRequirement | undefined {
    return this.requirements.get(requirementId);
  }

  getAll(): StructuredRequirement[] {
    return Array.from(this.requirements.values());
  }

  private extractObjective(
    input: string,
    sections: RequirementSections
  ): string {
    const firstSectionIndex = sections.firstSectionIndex;
    const preamble = input
      .slice(0, firstSectionIndex ?? input.length)
      .trim();

    return preamble || input.split(/[.!?]/)[0].trim();
  }

  private extractSections(input: string): RequirementSections {
    const sections: RequirementSections = {
      requirements: [],
      constraints: [],
      deliverables: [],
      acceptanceCriteria: [],
      firstSectionIndex: undefined,
    };
    const labels = /\b(Requirements|Constraints|Deliverables|Acceptance Criteria)\s*:\s*/gi;
    const matches = Array.from(input.matchAll(labels));

    if (matches.length === 0) {
      return sections;
    }

    sections.firstSectionIndex = matches[0].index;

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const label = match[1].toLowerCase();
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? input.length;
      const values = this.splitSection(input.slice(start, end));

      if (label === "requirements") {
        sections.requirements = values;
      } else if (label === "constraints") {
        sections.constraints = values;
      } else if (label === "deliverables") {
        sections.deliverables = values;
      } else {
        sections.acceptanceCriteria = values;
      }
    }

    return sections;
  }

  private splitSection(section: string): string[] {
    return section
      .split(/\r?\n|[.;]/)
      .map((value) => value.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  private inferDeliverables(objective: string): string[] {
    if (/^(build|create|deliver|provide|launch|implement|develop|design)\b/i.test(objective)) {
      return [objective];
    }

    return [];
  }

  private extractPriority(input: string): RequirementPriority {
    if (/\b(critical|urgent|emergency)\b/i.test(input)) {
      return "critical";
    }

    if (/\b(high priority|high-priority)\b/i.test(input)) {
      return "high";
    }

    if (/\blow priority\b/i.test(input)) {
      return "low";
    }

    return "medium";
  }

  private getClarificationQuestions(input: {
    requirements: string[];
    constraints: string[];
    deliverables: string[];
    acceptanceCriteria: string[];
  }): string[] {
    const questions: string[] = [];

    if (input.requirements.length === 0) {
      questions.push("Which functional requirements are essential?");
    }

    if (input.deliverables.length === 0) {
      questions.push("What deliverables should the organization produce?");
    }

    if (input.constraints.length === 0) {
      questions.push(
        "Are there technical, budget, timeline, or compliance constraints?"
      );
    }

    if (input.acceptanceCriteria.length === 0) {
      questions.push("What criteria will determine that the work is complete?");
    }

    return questions;
  }
}

interface RequirementSections {
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  firstSectionIndex: number | undefined;
}