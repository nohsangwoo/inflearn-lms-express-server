import type { Router as ExpressRouter } from "express";
import { Router } from "express";

export const createRouter = (): ExpressRouter => Router();

export type { ExpressRouter };