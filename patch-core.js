'use strict';
const url = require('url');
const https = require('https');

/**
 * This currently needs to be applied to all Node.js versions
 * in order to determine if the `req` is an HTTP or HTTPS request.
 *
 * There is currently no PR attempting to move this property upstream.
 */
const patchMarker = "__agent_base_https_request_patched__";
if (!https.request[patchMarker]) {
  https.request = (function(request) {
    return function(...args) {
      let options = {};
      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        if (typeof args[1] !== 'function') {
          args[1] = Object.assign(options, args[1]);
        }
        else {
          let tmp = args.shift();
          args.unshift(options);
          args.unshift(tmp);
        }
      } else {
        args[0] = Object.assign(options, args[0]);
      }
      if (null == options.port) {
        options.port = 443;
      }
      options.secureEndpoint = true;
      args.unshift(https);

      return request.call(...args);
    };
  })(https.request);
  https.request[patchMarker] = true;
}

/**
 * This is needed for Node.js >= 9.0.0 to make sure `https.get()` uses the
 * patched `https.request()`.
 *
 * Ref: https://github.com/nodejs/node/commit/5118f31
 */
https.get = function (_url, _options, cb) {
    let options;
    if (typeof _url === 'string' && _options && typeof _options !== 'function') {
      options = Object.assign({}, url.parse(_url), _options);
    } else if (!_options && !cb) {
      options = _url;
    } else if (!cb) {
      options = _url;
      cb = _options;
    }

  const req = https.request(options, cb);
  req.end();
  return req;
};
