import { afterEach, describe, expect, it, vi } from "vitest";
import {
  friendbotFund,
  FriendbotRetryableError,
  FRIEND_BOT_RATE_LIMIT_MESSAGE,
} from "./friendbot.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("friendbotFund", () => {
  it("resolves when Friendbot funds the account", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(friendbotFund("GEXAMPLE")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://friendbot.stellar.org?addr=GEXAMPLE");
  });

  it("treats an already-funded response as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(friendbotFund("GEXAMPLE")).resolves.toBeUndefined();
  });

  it.each([429, 500, 503])("marks HTTP %i as retryable", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));

    await expect(friendbotFund("GEXAMPLE")).rejects.toMatchObject({
      name: "FriendbotRetryableError",
      status,
      message: FRIEND_BOT_RATE_LIMIT_MESSAGE,
    });
    await expect(friendbotFund("GEXAMPLE")).rejects.toBeInstanceOf(FriendbotRetryableError);
  });

  it("keeps permanent HTTP failures non-retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(friendbotFund("GEXAMPLE")).rejects.toThrow("friendbot funding failed: 403");
    await expect(friendbotFund("GEXAMPLE")).rejects.not.toBeInstanceOf(FriendbotRetryableError);
  });
});