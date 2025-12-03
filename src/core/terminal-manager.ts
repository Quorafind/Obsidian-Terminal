import {
	TerminalManager as BaseTerminalManager,
	TerminalSession,
	TerminalPluginError,
	TerminalErrorType,
} from "@/types";
import { PTYManager } from "./pty-manager";

/**
 * Terminal manager implementation for managing multiple terminal sessions
 * Handles session lifecycle, resource management, and coordination
 */
export class TerminalManager extends BaseTerminalManager {
	public terminals: Map<string, TerminalSession> = new Map();
	private ptyManager: PTYManager;
	private sessionCounter: number = 0;

	constructor(ptyManager: PTYManager) {
		super();
		this.ptyManager = ptyManager;
	}

	/**
	 * Create a new terminal session
	 */
	createTerminal(id?: string): TerminalSession {
		try {
			// Generate unique ID if not provided
			const sessionId = id || this.generateSessionId();

			// Check if terminal with this ID already exists
			if (this.terminals.has(sessionId)) {
				throw new TerminalPluginError(
					TerminalErrorType.VIEW_CREATION_FAILED,
					`Terminal with ID ${sessionId} already exists`,
				);
			}

			// Get default PTY options
			const ptyOptions = this.ptyManager.getDefaultOptions();

			// Create PTY process
			const ptyProcess = this.ptyManager.createPTY(ptyOptions);

			// Create terminal session
			const session: TerminalSession = {
				id: sessionId,
				ptyProcess,
				isActive: true,
				view: undefined, // Will be set when view is created
			};

			// Store the session
			this.terminals.set(sessionId, session);

			// Set up PTY event handlers for session management
			this.setupPTYEventHandlers(session);

			return session;
		} catch (error) {
			if (error instanceof TerminalPluginError) {
				throw error;
			}

			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				"Failed to create terminal session",
				error as Error,
				{ id },
			);
		}
	}

	/**
	 * Destroy a terminal session and clean up resources
	 */
	destroyTerminal(id: string): void {
		try {
			const session = this.terminals.get(id);
			if (!session) {
				console.warn(`Terminal session ${id} not found`);
				return;
			}

			// Mark session as inactive
			session.isActive = false;

			// Remove from sessions map BEFORE killing PTY
			// This ensures exit handler will ignore the event
			this.terminals.delete(id);

			// Clean up view reference
			if (session.view) {
				session.view = undefined;
			}

			// Clean up PTY process (kill after removing from map)
			try {
				this.ptyManager.destroyPTY(session.ptyProcess);
			} catch (error) {
				console.warn(`Failed to destroy PTY for session ${id}:`, error);
			}

			console.log(`Terminal session ${id} destroyed`);
		} catch (error) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				`Failed to destroy terminal session: ${id}`,
				error as Error,
				{ id },
			);
		}
	}

	/**
	 * Get a terminal session by ID
	 */
	getTerminal(id: string): TerminalSession | undefined {
		return this.terminals.get(id);
	}

	/**
	 * Get all active terminal sessions
	 */
	getActiveTerminals(): TerminalSession[] {
		return Array.from(this.terminals.values()).filter(
			(session) => session.isActive,
		);
	}

	/**
	 * Get all terminal session IDs
	 */
	getTerminalIds(): string[] {
		return Array.from(this.terminals.keys());
	}

	/**
	 * Check if a terminal session exists
	 */
	hasTerminal(id: string): boolean {
		return this.terminals.has(id);
	}

	/**
	 * Get the count of active terminals
	 */
	getActiveTerminalCount(): number {
		return this.getActiveTerminals().length;
	}

	/**
	 * Clean up all terminal sessions
	 */
	cleanup(): void {
		try {
			const sessionIds = Array.from(this.terminals.keys());

			// Destroy all sessions
			sessionIds.forEach((id) => {
				try {
					this.destroyTerminal(id);
				} catch (error) {
					console.warn(
						`Failed to cleanup terminal session ${id}:`,
						error,
					);
				}
			});

			// Clear the map
			this.terminals.clear();

			// Clean up PTY manager
			this.ptyManager.cleanup();

			console.log("Terminal manager cleanup completed");
		} catch (error) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				"Failed to cleanup terminal manager",
				error as Error,
			);
		}
	}

	/**
	 * Restart a terminal session
	 */
	async restartTerminal(id: string): Promise<TerminalSession> {
		const existingSession = this.terminals.get(id);
		if (!existingSession) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				`Terminal session ${id} not found`,
			);
		}

		// Store view reference
		const view = existingSession.view;

		// Destroy the existing session
		this.destroyTerminal(id);

		// Create new session with same ID
		const newSession = this.createTerminal(id);

		// Restore view reference
		if (view) {
			newSession.view = view;
		}

		return newSession;
	}

	/**
	 * Resize all active terminals
	 */
	resizeAllTerminals(cols: number, rows: number): void {
		this.getActiveTerminals().forEach((session) => {
			try {
				session.ptyProcess.resize(cols, rows);
			} catch (error) {
				console.warn(`Failed to resize terminal ${session.id}:`, error);
			}
		});
	}

	/**
	 * Generate unique session ID
	 */
	private generateSessionId(): string {
		this.sessionCounter++;
		const timestamp = Date.now().toString(36);
		return `terminal-${timestamp}-${this.sessionCounter}`;
	}

	/**
	 * Set up PTY event handlers for session management
	 */
	private setupPTYEventHandlers(session: TerminalSession): void {
		const { ptyProcess, id } = session;

		// Handle PTY process exit
		ptyProcess.on("exit", (exitCode: number, signal?: number) => {
			// Check if this session is still valid (not replaced by restart)
			const currentSession = this.terminals.get(id);
			if (!currentSession || currentSession.ptyProcess !== ptyProcess) {
				// Session was replaced or removed, ignore this exit event
				console.log(
					`PTY exit event ignored for replaced session ${id}`,
				);
				return;
			}

			console.log(
				`PTY process for session ${id} exited with code ${exitCode}, signal ${signal}`,
			);

			// Mark session as inactive but don't destroy it yet
			// This allows the user to see the exit message and restart if needed
			session.isActive = false;

			// Notify view if it exists
			if (
				session.view &&
				typeof (session.view as any).onPTYExit === "function"
			) {
				(session.view as any).onPTYExit(exitCode, signal);
			}
		});

		// Handle PTY process errors
		ptyProcess.on("error", (error: Error) => {
			// Check if this session is still valid (not replaced by restart)
			const currentSession = this.terminals.get(id);
			if (!currentSession || currentSession.ptyProcess !== ptyProcess) {
				// Session was replaced or removed, ignore this error event
				return;
			}

			console.error(`PTY process error for session ${id}:`, error);

			// Mark session as inactive
			session.isActive = false;

			// Notify view if it exists
			if (
				session.view &&
				typeof (session.view as any).onPTYError === "function"
			) {
				(session.view as any).onPTYError(error);
			}
		});

		// Handle spawn event
		ptyProcess.on("spawn", () => {
			console.log(`PTY process spawned for session ${id}`);
			session.isActive = true;
		});
	}

	/**
	 * Find available shell and create terminal with it
	 * On macOS, includes retry logic and shell fallback for posix_spawnp issues
	 */
	async createTerminalWithAvailableShell(
		id?: string,
	): Promise<TerminalSession> {
		// Generate unique ID if not provided
		const sessionId = id || this.generateSessionId();

		// Check if terminal with this ID already exists
		if (this.terminals.has(sessionId)) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				`Terminal with ID ${sessionId} already exists`,
			);
		}

		const isMacOS = process.platform === "darwin";
		const shellsToTry = await this.getShellsToTry();
		let lastError: Error | null = null;

		// On macOS, try multiple shells due to posix_spawnp issues with node-pty 1.0+
		// System shells (/bin/zsh, /bin/bash) are more reliable than Homebrew shells
		for (const shell of shellsToTry) {
			// On macOS, add retry logic for transient posix_spawnp failures
			const maxRetries = isMacOS ? 3 : 1;

			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					console.log(
						`🔄 Attempting to spawn shell: ${shell} (attempt ${attempt}/${maxRetries})`,
					);

					const ptyOptions = this.ptyManager.getDefaultOptions();
					ptyOptions.shell = shell;

					// Create PTY process
					const ptyProcess = this.ptyManager.createPTY(ptyOptions);

					// Create terminal session
					const session: TerminalSession = {
						id: sessionId,
						ptyProcess,
						isActive: true,
						view: undefined,
					};

					// Store the session
					this.terminals.set(sessionId, session);

					// Set up PTY event handlers
					this.setupPTYEventHandlers(session);

					console.log(`✅ Successfully spawned shell: ${shell}`);
					return session;
				} catch (error) {
					lastError = error as Error;
					const errorMsg = (error as Error)?.message || "";

					console.warn(
						`⚠️ Failed to spawn ${shell} (attempt ${attempt}): ${errorMsg}`,
					);

					// On macOS, if it's a posix_spawnp error, wait briefly before retry
					if (isMacOS && errorMsg.includes("posix_spawnp")) {
						if (attempt < maxRetries) {
							console.log(
								`⏳ Waiting 100ms before retry (posix_spawnp issue)...`,
							);
							await this.sleep(100);
						}
					} else {
						// For non-posix_spawnp errors, don't retry, try next shell
						break;
					}
				}
			}
		}

		// All shells failed
		throw new TerminalPluginError(
			TerminalErrorType.PTY_CREATION_FAILED,
			`Failed to create terminal. Tried shells: ${shellsToTry.join(", ")}. Last error: ${lastError?.message}`,
			lastError || undefined,
		);
	}

	/**
	 * Get list of shells to try, prioritizing system shells on macOS
	 */
	private async getShellsToTry(): Promise<string[]> {
		const alternatives = this.ptyManager.getAlternativeShells();
		const preferredShell = await this.ptyManager.findAvailableShell();

		// Build ordered list: preferred shell first, then alternatives
		const shells: string[] = [];

		if (preferredShell && !shells.includes(preferredShell)) {
			shells.push(preferredShell);
		}

		for (const shell of alternatives) {
			if (!shells.includes(shell)) {
				shells.push(shell);
			}
		}

		return shells;
	}

	/**
	 * Sleep helper for retry delays
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
