import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MemberRing, { type Member } from "./MemberRing";

const members: Member[] = [
  { id: "1", name: "Ada", initials: "AD", amount: 120 },
  { id: "2", name: "Grace", initials: "GR", amount: 80 },
  { id: "3", name: "Linus", initials: "LI", amount: 40, ineligible: true },
];

describe("MemberRing", () => {
  it("renders an SVG that scales via viewBox", () => {
    const { container } = render(<MemberRing members={members} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox");
  });

  it("renders a node for every member", () => {
    render(<MemberRing members={members} />);
    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(screen.getByText("LI")).toBeInTheDocument();
  });

  it("marks a member who has already claimed as ineligible", () => {
    render(<MemberRing members={members} />);
    expect(
      screen.getByLabelText(/already claimed/i),
    ).toBeInTheDocument();
  });

  it("does not mark eligible members as ineligible", () => {
    render(<MemberRing members={members} />);
    expect(screen.queryByLabelText(/Ada.*already claimed/i)).toBeNull();
  });
});
