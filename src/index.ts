import * as net from "net";
import * as http from "http";
import * as https from "https";
import { Duplex } from "stream";
import { EventEmitter } from "events";
import createDebug from "debug";
import promisify from "./promisify";

const debug = createDebug("agent-base");

function isAgent(v: any): v is AgentLike {
	return Boolean(v) && typeof v.addRequest === "function";
}

function isSecureEndpoint(): boolean {
	const { stack } = new Error();
	if (typeof stack !== "string") return false;
	return stack
		.split("\n")
		.some(
			(l) =>
				l.indexOf("(https.js:") !== -1 ||
				l.indexOf("node:https:") !== -1
		);
}

//function createAgent(opts?: AgentOptions): createAgent.Agent;
//function createAgent(
//	callback: AgentCallback,
//	opts?: AgentOptions
//): Agent;
//function createAgent(
//	callback?: AgentCallback | createAgent.AgentOptions,
//	opts?: AgentOptions
//) {
//	return new Agent(callback, opts);
//}

export interface ClientRequest extends http.ClientRequest {
	_last?: boolean;
	_hadError?: boolean;
	method: string;
}

export interface AgentRequestOptions {
	host?: string;
	path?: string;
	// `port` on `http.RequestOptions` can be a string or undefined,
	// but `net.TcpNetConnectOpts` expects only a number
	port: number;
}

export interface HttpRequestOptions
	extends AgentRequestOptions,
		Omit<http.RequestOptions, keyof AgentRequestOptions> {
	secureEndpoint: false;
}

export interface HttpsRequestOptions
	extends AgentRequestOptions,
		Omit<https.RequestOptions, keyof AgentRequestOptions> {
	secureEndpoint: true;
}

export type RequestOptions = HttpRequestOptions | HttpsRequestOptions;

export type AgentLike = Pick<Agent, "addRequest"> | http.Agent;

export type AgentCallbackReturn = Duplex | AgentLike;

export type AgentCallbackCallback = (
	err?: Error | null,
	socket?: AgentCallbackReturn
) => void;

export type AgentCallbackPromise = (
	req: ClientRequest,
	opts: RequestOptions
) => AgentCallbackReturn | Promise<AgentCallbackReturn>;

export type AgentCallback = typeof Agent.prototype.callback;

export type AgentOptions = {
	timeout?: number;
};

/**
 * Base `http.Agent` implementation.
 * No pooling/keep-alive is implemented by default.
 *
 * @param {Function} callback
 * @api public
 */
export class Agent extends EventEmitter {
	public timeout: number | null;
	public maxFreeSockets: number;
	public maxTotalSockets: number;
	public maxSockets: number;
	public sockets: {
		[key: string]: net.Socket[];
	};
	public freeSockets: {
		[key: string]: net.Socket[];
	};
	public requests: {
		[key: string]: http.IncomingMessage[];
	};
	public options: https.AgentOptions;
	private promisifiedCallback?: AgentCallbackPromise;
	private explicitDefaultPort?: number;
	private explicitProtocol?: string;

	constructor(callback?: AgentCallback | AgentOptions, _opts?: AgentOptions) {
		super();

		let opts = _opts;
		if (typeof callback === "function") {
			this.callback = callback;
		} else if (callback) {
			opts = callback;
		}

		// Timeout for the socket to be returned from the callback
		this.timeout = null;
		if (opts && typeof opts.timeout === "number") {
			this.timeout = opts.timeout;
		}

		// These aren't actually used by `agent-base`, but are required
		// for the TypeScript definition files in `@types/node` :/
		this.maxFreeSockets = 1;
		this.maxSockets = 1;
		this.maxTotalSockets = Infinity;
		this.sockets = {};
		this.freeSockets = {};
		this.requests = {};
		this.options = {};
	}

	get defaultPort(): number {
		if (typeof this.explicitDefaultPort === "number") {
			return this.explicitDefaultPort;
		}
		return isSecureEndpoint() ? 443 : 80;
	}

	set defaultPort(v: number) {
		this.explicitDefaultPort = v;
	}

	get protocol(): string {
		if (typeof this.explicitProtocol === "string") {
			return this.explicitProtocol;
		}
		return isSecureEndpoint() ? "https:" : "http:";
	}

	set protocol(v: string) {
		this.explicitProtocol = v;
	}

	callback(
		req: ClientRequest,
		opts: RequestOptions,
		fn: AgentCallbackCallback
	): void;
	callback(
		req: ClientRequest,
		opts: RequestOptions
	): AgentCallbackReturn | Promise<AgentCallbackReturn>;
	callback(
		req: ClientRequest,
		opts: AgentOptions,
		fn?: AgentCallbackCallback
	): AgentCallbackReturn | Promise<AgentCallbackReturn> | void {
		throw new Error(
			'"agent-base" has no default implementation, you must subclass and override `callback()`'
		);
	}

	/**
	 * Called by node-core's "_http_client.js" module when creating
	 * a new HTTP request with this Agent instance.
	 *
	 * @api public
	 */
	addRequest(req: ClientRequest, _opts: RequestOptions): void {
		const opts: RequestOptions = { ..._opts };

		if (typeof opts.secureEndpoint !== "boolean") {
			// @ts-ignore
			opts.secureEndpoint = isSecureEndpoint();
		}

		if (opts.host == null) {
			opts.host = "localhost";
		}

		if (opts.port == null) {
			opts.port = opts.secureEndpoint ? 443 : 80;
		}

		if (opts.protocol == null) {
			opts.protocol = opts.secureEndpoint ? "https:" : "http:";
		}

		if (opts.host && opts.path) {
			// If both a `host` and `path` are specified then it's most
			// likely the result of a `url.parse()` call... we need to
			// remove the `path` portion so that `net.connect()` doesn't
			// attempt to open that as a unix socket file.
			delete opts.path;
		}

		delete opts.agent;
		delete opts.hostname;
		delete opts._defaultAgent;
		delete opts.defaultPort;
		delete opts.createConnection;

		// Hint to use "Connection: close"
		// XXX: non-documented `http` module API :(
		req._last = true;
		req.shouldKeepAlive = false;

		let timedOut = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const timeoutMs = opts.timeout || this.timeout;

		const onerror = (err: NodeJS.ErrnoException) => {
			if (req._hadError) return;
			req.emit("error", err);
			// For Safety. Some additional errors might fire later on
			// and we need to make sure we don't double-fire the error event.
			req._hadError = true;
		};

		const ontimeout = () => {
			timeoutId = null;
			timedOut = true;
			const err: NodeJS.ErrnoException = new Error(
				`A "socket" was not created for HTTP request before ${timeoutMs}ms`
			);
			err.code = "ETIMEOUT";
			onerror(err);
		};

		const callbackError = (err: NodeJS.ErrnoException) => {
			if (timedOut) return;
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			onerror(err);
		};

		const onsocket = (socket: AgentCallbackReturn) => {
			if (timedOut) return;
			if (timeoutId != null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}

			if (isAgent(socket)) {
				// `socket` is actually an `http.Agent` instance, so
				// relinquish responsibility for this `req` to the Agent
				// from here on
				debug(
					"Callback returned another Agent instance %o",
					socket.constructor.name
				);
				(socket as Agent).addRequest(req, opts);
				return;
			}

			if (socket) {
				socket.once("free", () => {
					this.freeSocket(socket as net.Socket, opts);
				});
				req.onSocket(socket as net.Socket);
				return;
			}

			const err = new Error(
				`no Duplex stream was returned to agent-base for \`${req.method} ${req.path}\``
			);
			onerror(err);
		};

		if (typeof this.callback !== "function") {
			onerror(new Error("`callback` is not defined"));
			return;
		}

		if (!this.promisifiedCallback) {
			if (this.callback.length >= 3) {
				debug("Converting legacy callback function to promise");
				this.promisifiedCallback = promisify(this.callback);
			} else {
				this.promisifiedCallback = this.callback;
			}
		}

		if (typeof timeoutMs === "number" && timeoutMs > 0) {
			timeoutId = setTimeout(ontimeout, timeoutMs);
		}

		if ("port" in opts && typeof opts.port !== "number") {
			opts.port = Number(opts.port);
		}

		try {
			debug(
				"Resolving socket for %o request: %o",
				opts.protocol,
				`${req.method} ${req.path}`
			);
			Promise.resolve(this.promisifiedCallback(req, opts)).then(
				onsocket,
				callbackError
			);
		} catch (err) {
			Promise.reject(err).catch(callbackError);
		}
	}

	freeSocket(socket: net.Socket, opts: AgentOptions) {
		debug("Freeing socket %o %o", socket.constructor.name, opts);
		socket.destroy();
	}

	destroy() {
		debug("Destroying agent %o", this.constructor.name);
	}
}

export default Agent;