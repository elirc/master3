import { describe, expect, it } from "vitest";
import {
  assertTicketTransition,
  calculateSlaDueAt,
  canAssignTicket,
  canTransitionTicket,
  getSlaState
} from "@support/domain";

describe("ticket workflow rules", () => {
  it("allows agents to move resolved tickets to closed", () => {
    expect(canTransitionTicket({ from: "RESOLVED", to: "CLOSED", actorRole: "AGENT" })).toBe(true);
  });

  it("blocks viewers from changing status", () => {
    expect(canTransitionTicket({ from: "NEW", to: "OPEN", actorRole: "VIEWER" })).toBe(false);
  });

  it("throws for invalid transitions", () => {
    expect(() => assertTicketTransition({ from: "NEW", to: "CLOSED", actorRole: "AGENT" })).toThrow();
  });
});

describe("SLA rules", () => {
  it("calculates urgent SLA due date two hours after creation", () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    expect(calculateSlaDueAt(createdAt, "URGENT").toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("marks open tickets near due time as at risk", () => {
    const state = getSlaState(new Date("2026-01-01T11:10:00.000Z"), {
      status: "OPEN",
      priority: "URGENT",
      dueAt: "2026-01-01T12:00:00.000Z"
    });
    expect(state).toBe("AT_RISK");
  });

  it("pauses pending tickets", () => {
    expect(getSlaState(new Date(), { status: "PENDING", priority: "NORMAL", dueAt: new Date() })).toBe("PAUSED");
  });
});

describe("authorization helpers", () => {
  it("lets operational roles assign tickets", () => {
    expect(canAssignTicket("ADMIN")).toBe(true);
    expect(canAssignTicket("VIEWER")).toBe(false);
  });
});
