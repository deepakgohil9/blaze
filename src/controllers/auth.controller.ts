import { type Response, type NextFunction } from 'express'
import ms from 'ms'
import { HttpException, httpErrors } from '../utils/HttpException'
import ApiResponse from '../utils/ApiResponse'
import asyncHandler, { type Req } from '../utils/asyncHandler'
import { generateTokens, generateAccessToken, verifyToken } from '../utils/jwt.utils'
import { getAuthUrl, getUserData } from '../remotes/google-oauth.remote'

import { type AuthSchemaType, type GoogleCallbackSchemaType } from '../schemas/auth.schema'
import { type EmptySchemaType } from '../schemas/common.schema'
import * as userService from '../services/user.service'
import { type UserDocument } from '../models/user.model'

const refreshExpiresIn = ms(process.env.JWT_REFRESH_EXPIRES_IN ?? '30d')

export const register = asyncHandler(async (
	req: Req<AuthSchemaType>,
	res: Response,
	next: NextFunction): Promise<void> => {
	const user = await userService.create({ signin_method: 'email', ...req.body })
	const data = user.toObject<UserDocument>()
	delete data.password
	res.status(201).send(new ApiResponse<UserDocument>('User created successfully', data))
})

export const signin = asyncHandler(async (
	req: Req<AuthSchemaType>,
	res: Response,
	next: NextFunction): Promise<void> => {
	const user = await userService.findOne({ email: req.body.email }, { signin_method: 1, email: 1, password: 1 }, { lean: false })

	if (user === null) {
		throw new HttpException(httpErrors.NOT_FOUND, 'User not found')
	}

	if (user.signin_method !== 'email') {
		throw new HttpException(httpErrors.BAD_REQUEST, `User signed up with ${user.signin_method}`)
	}

	const isMatch = await user.comparePassword(req.body.password)

	if (!isMatch) {
		throw new HttpException(httpErrors.UNAUTHORIZED, 'Invalid credentials')
	}

	const tokens = generateTokens({ id: user._id })
	res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, sameSite: 'strict', maxAge: refreshExpiresIn })
	res.status(200).send(new ApiResponse<{ accessToken: string }>('User signed in successfully', { accessToken: tokens.accessToken }))
})

export const googleSignIn = asyncHandler((
	req: Req<EmptySchemaType>,
	res: Response,
	next: NextFunction): void => {
	const authUrl = getAuthUrl()
	res.redirect(authUrl)
})

export const googleCallback = asyncHandler(async (
	req: Req<GoogleCallbackSchemaType>,
	res: Response,
	next: NextFunction): Promise<void> => {
	const userInfo = await getUserData(req.query.code)

	if (userInfo === null) {
		throw new HttpException(httpErrors.UNAUTHORIZED, 'Invalid Grant Code')
	}

	let user = await userService.findOne({ email: userInfo.email }, { signin_method: 1, email: 1 }, { lean: true })

	if (user === null) {
		user = await userService.create({ signin_method: 'google', email: userInfo.email })
	}

	const tokens = generateTokens({ id: user._id })
	res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, sameSite: 'strict', maxAge: refreshExpiresIn })
	res.status(200).send(new ApiResponse<{ accessToken: string }>('User signed in successfully', { accessToken: tokens.accessToken }))
})

export const issueAccessToken = asyncHandler(async (
	req: Req<EmptySchemaType>,
	res: Response,
	next: NextFunction): Promise<void> => {
	const refreshToken = req.cookies?.refreshToken

	if (refreshToken === undefined || refreshToken === null) {
		throw new HttpException(httpErrors.UNAUTHORIZED, 'Access denied')
	}

	const payload = verifyToken(refreshToken as string, 'refresh')
	if (payload === null) {
		throw new HttpException(httpErrors.UNAUTHORIZED, 'Invalid token')
	}

	const accessToken = generateAccessToken({ id: payload.id })
	res.status(200).send(new ApiResponse<{ accessToken: string }>('Access token generated successfully', { accessToken }))
})
