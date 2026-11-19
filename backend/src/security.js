import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
const secret=()=>{if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw new Error('JWT_SECRET must be at least 32 characters. Configure .env.');return process.env.JWT_SECRET;};
export const hashPassword=p=>bcrypt.hash(p,12);
export const verifyPassword=(p,h)=>bcrypt.compare(p,h);
export const signToken=user=>jwt.sign({sub:String(user.id),role:user.role,email:user.email,name:user.full_name},secret(),{expiresIn:process.env.JWT_EXPIRES_IN||'8h',issuer:'nourish-hub'});
export function authenticate(req,res,next){const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Authentication required'});try{req.user=jwt.verify(token,secret(),{issuer:'nourish-hub'});next();}catch{return res.status(401).json({error:'Session expired or invalid. Please sign in again.'});}}
export const allow=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'You do not have permission to perform this action'});
