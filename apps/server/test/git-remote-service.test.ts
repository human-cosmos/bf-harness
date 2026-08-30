import { describe, expect, it } from "vitest";
import { GitRemoteService } from "../src/services/git-remote-service.js";

describe("GitRemoteService.parseRemoteUrl", () => {
  const service = new GitRemoteService();

  it("normalizes a GitHub HTTPS url", () => {
    const info = service.parseRemoteUrl(
      "https://github.com/acme/web-service.git",
    );
    expect(info).toEqual({
      host: "github",
      owner: "acme",
      repo: "web-service",
      cloneUrl: "https://github.com/acme/web-service.git",
    });
  });

  it("accepts a shorthand url without scheme", () => {
    const info = service.parseRemoteUrl("gitlab.com/acme/api");
    expect(info.host).toBe("gitlab");
    expect(info.owner).toBe("acme");
    expect(info.repo).toBe("api");
    expect(info.cloneUrl).toBe("https://gitlab.com/acme/api");
  });

  it("supports GitLab subgroup namespaces", () => {
    const info = service.parseRemoteUrl(
      "https://gitlab.com/group/subgroup/api.git",
    );
    expect(info.host).toBe("gitlab");
    expect(info.owner).toBe("group/subgroup");
    expect(info.repo).toBe("api");
  });

  it("strips credentials from the normalized clone url", () => {
    const info = service.parseRemoteUrl(
      "https://user:secret@github.com/acme/repo.git",
    );
    expect(info.cloneUrl).toBe("https://github.com/acme/repo.git");
  });

  it("rejects ssh and http urls", () => {
    expect(() => service.parseRemoteUrl("git@github.com:acme/repo.git")).toThrow(
      /SSH/,
    );
    expect(() => service.parseRemoteUrl("http://github.com/acme/repo")).toThrow(
      /HTTPS/,
    );
  });

  it("rejects unsupported hosts and incomplete paths", () => {
    expect(() =>
      service.parseRemoteUrl("https://bitbucket.org/acme/repo"),
    ).toThrow(/github.com|gitlab.com/);
    expect(() =>
      service.parseRemoteUrl("https://github.com/onlyowner"),
    ).toThrow(/owner\/repo/);
  });
});
