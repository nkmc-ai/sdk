import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGatewayStop, runGatewayStatus } from "../../src/commands/gateway.js";

describe("gateway PID file management", () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `nkmc-gw-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("runGatewayStop", () => {
    it("should print 'No running gateway found.' when no PID file exists", async () => {
      await runGatewayStop({ dataDir: tempDir });
      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No running gateway found.");
    });

    it("should remove stale PID file and print appropriate message", async () => {
      const pidFile = join(tempDir, "gateway.pid");
      writeFileSync(pidFile, "999999999", "utf-8");

      await runGatewayStop({ dataDir: tempDir });

      expect(existsSync(pidFile)).toBe(false);
      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("stale PID file removed");
    });

    it("should kill running process and remove PID file", async () => {
      const pidFile = join(tempDir, "gateway.pid");
      writeFileSync(pidFile, String(process.pid), "utf-8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      await runGatewayStop({ dataDir: tempDir });

      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      expect(existsSync(pidFile)).toBe(false);
      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain(`Gateway stopped (PID ${process.pid})`);
    });
  });

  describe("runGatewayStatus", () => {
    it("should print 'Gateway is not running.' when no PID file exists", () => {
      runGatewayStatus({ dataDir: tempDir });

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Gateway is not running.");
    });

    it("should clean up stale PID file and report not running", () => {
      // Write a PID file with a PID that does not exist
      const pidFile = join(tempDir, "gateway.pid");
      writeFileSync(pidFile, "999999999", "utf-8");

      runGatewayStatus({ dataDir: tempDir });

      // PID file should be cleaned up
      expect(existsSync(pidFile)).toBe(false);

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("stale PID file cleaned up");
    });

    it("should report running when process is alive", () => {
      // Use current process PID (which is alive)
      const pidFile = join(tempDir, "gateway.pid");
      writeFileSync(pidFile, String(process.pid), "utf-8");

      // Mock process.kill(pid, 0) to not throw (process exists)
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      runGatewayStatus({ dataDir: tempDir });

      expect(killSpy).toHaveBeenCalledWith(process.pid, 0);

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain(`Gateway is running (PID ${process.pid})`);
      expect(output).toContain(`Data: ${tempDir}`);
    });

    it("should use default dataDir when not specified", () => {
      // Just verify it doesn't throw — it will look in ~/.nkmc/server which likely has no PID file
      runGatewayStatus({});

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      // Should either report not running or running, but not throw
      expect(output).toMatch(/Gateway is (not )?running/);
    });
  });
});
