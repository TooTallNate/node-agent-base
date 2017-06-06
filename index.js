'use strict';

/**
 * Module dependencies.
 */

require('./patch-core');
const extend = require('extend');
const inherits = require('util').inherits;
const promisify = require('es6-promisify');
const EventEmitter = require('events').EventEmitter;

/**
 * Module exports.
 */

module.exports = Agent;

/**
 * Base `http.Agent` implementation.
 * No pooling/keep-alive is implemented by default.
 *
 * @param {Function} callback
 * @api public
 */

function Agent(callback, _opts) {
  if (!(this instanceof Agent)) {
    return new Agent(callback, _opts);
  }

  EventEmitter.call(this);

  let opts = _opts;
  if ('function' === typeof callback) {
    this.callback = callback;
  } else if (callback) {
    opts = callback;
  }

  if (this.callback.length >= 3) {
    // legacy callback function, convert to Promise
    this.callback = promisify(this.callback);
  }

  // timeout for the socket to be returned from the callback
  this.timeout = (opts && opts.timeout) || null;
}
inherits(Agent, EventEmitter);

/**
 * Override this function in your subclass!
 */
Agent.prototype.callback = function callback(req, opts) {
  throw new Error(
    '"agent-base" has no default implementation, you must subclass and override `callback()`'
  );
};

/**
 * Called by node-core's "_http_client.js" module when creating
 * a new HTTP request with this Agent instance.
 *
 * @api public
 */

Agent.prototype.addRequest = function addRequest(
  req,
  _opts
) {
  const opts = Object.assign({}, _opts);

  if (opts.host && opts.path) {
    // if both a `host` and `path` are specified then it's most likely the
    // result of a `url.parse()` call... we need to remove the `path` portion so
    // that `net.connect()` doesn't attempt to open that as a unix socket file.
    delete opts.path;
  }

  // set default `port` for HTTP if none was explicitly specified
  if (null == opts.port) {
    opts.port = opts.secureEndpoint ? 443 : 80;
  }

  delete opts.agent;
  delete opts.hostname;
  delete opts._defaultAgent;
  delete opts.defaultPort;
  delete opts.createConnection;

  // hint to use "Connection: close"
  // XXX: non-documented `http` module API :(
  req._last = true;
  req.shouldKeepAlive = false;

  // create the `stream.Duplex` instance
  let timeout;
  let timedOut = false;
  const timeoutMs = this.timeout;

  function onerror(err) {
    if (req._hadError) return;
    req.emit('error', err);
    // For Safety. Some additional errors might fire later on
    // and we need to make sure we don't double-fire the error event.
    req._hadError = true;
  }

  function ontimeout() {
    timedOut = true;
    const err = new Error(
      'A "socket" was not created for HTTP request before ' + timeoutMs + 'ms'
    );
    err.code = 'ETIMEOUT';
    onerror(err);
  }

  function callbackError(err) {
    if (timedOut) return;
    if (timeout != null) {
      clearTimeout(timeout);
    }
    onerror(err);
  }

  function onsocket(socket) {
    if (timedOut) return;
    if (timeout != null) {
      clearTimeout(timeout);
    }
    req.onSocket(socket);
  }

  if (timeoutMs > 0) {
    timeout = setTimeout(ontimeout, timeoutMs);
  }

  try {
    Promise.resolve(this.callback(req, opts))
      .then(onsocket, callbackError);
  } catch (err) {
    Promise.reject(err)
      .catch(callbackError);
  }
};
