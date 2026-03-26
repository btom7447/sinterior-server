import { validationResult } from 'express-validator';
import AppError from '../utils/AppError.js';

/**
 * validate — runs express-validator checks accumulated by preceding
 * `check()` / `body()` / `param()` / `query()` calls, collects all
 * validation errors, and throws a single 400 AppError with every message
 * joined by "; " so the client receives all problems at once.
 *
 * Usage:
 *   import { body } from 'express-validator';
 *   import { validate } from '../middleware/validate.js';
 *
 *   router.post(
 *     '/register',
 *     [body('email').isEmail(), body('password').isLength({ min: 8 })],
 *     validate,
 *     register
 *   );
 *
 * @type {import('express').RequestHandler}
 */
const validate = (req, _res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg);
    return next(new AppError(messages.join('; '), 400));
  }

  next();
};

export default validate;
