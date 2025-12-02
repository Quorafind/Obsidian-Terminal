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
					`Terminal with ID ${sessionId} already exists`
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
				{ id }
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

			// Clean up PTY process
			try {
				this.ptyManager.destroyPTY(session.ptyProcess);
			} catch (error) {
				console.warn(`Failed to destroy PTY for session ${id}:`, error);
			}

			// Clean up view if it exists
			if (session.view) {
				try {
					// The view will handle its own cleanup
					session.view = undefined;
				} catch (error) {
					console.warn(`Failed to cleanup view for session ${id}:`, error);
				}
			}

			// Remove from sessions map
			this.terminals.delete(id);

			console.log(`Terminal session ${id} destroyed`);
		} catch (error) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				`Failed to destroy terminal session: ${id}`,
				error as Error,
				{ id }
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
		return Array.from(this.terminals.values()).filter(session => session.isActive);
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
			sessionIds.forEach(id => {
				try {
					this.destroyTerminal(id);
				} catch (error) {
					console.warn(`Failed to cleanup terminal session ${id}:`, error);
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
				error as Error
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
				`Terminal session ${id} not found`
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
		this.getActiveTerminals().forEach(session => {
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
			console.log(`PTY process for session ${id} exited with code ${exitCode}, signal ${signal}`);
			
			// Mark session as inactive but don't destroy it yet
			// This allows the user to see the exit message and restart if needed
			session.isActive = false;
			
			// Notify view if it exists
			if (session.view && typeof (session.view as any).onPTYExit === 'function') {
				(session.view as any).onPTYExit(exitCode, signal);
			}
		});

		// Handle PTY process errors
		ptyProcess.on("error", (error: Error) => {
			console.error(`PTY process error for session ${id}:`, error);
			
			// Mark session as inactive
			session.isActive = false;
			
			// Notify view if it exists
			if (session.view && typeof (session.view as any).onPTYError === 'function') {
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
	 */
	async createTerminalWithAvailableShell(id?: string): Promise<TerminalSession> {
		try {
			// Generate unique ID if not provided
			const sessionId = id || this.generateSessionId();

			// Check if terminal with this ID already exists
			if (this.terminals.has(sessionId)) {
				throw new TerminalPluginError(
					TerminalErrorType.VIEW_CREATION_FAILED,
					`Terminal with ID ${sessionId} already exists`
				);
			}

			// Try to find an available shell
			const availableShell = await this.ptyManager.findAvailableShell();
			
			// Get PTY options with the available shell
			const ptyOptions = this.ptyManager.getDefaultOptions();
			ptyOptions.shell = availableShell;

			// Create PTY process with the available shell
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
				TerminalErrorType.PTY_CREATION_FAILED,
				"Failed to create terminal with available shell",
				error as Error
			);
		}
	}
}
