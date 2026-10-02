import { after } from 'next/server';
import { submitPost } from '@/modules/enquiries';
export const runtime = 'nodejs';
export async function POST(request: Request) { return submitPost(request,after); }
