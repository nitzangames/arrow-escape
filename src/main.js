import { VERSION } from './balance.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#f4f1ea';
ctx.fillRect(0, 0, 1080, 1920);
ctx.fillStyle = '#2b2b2e';
ctx.font = '800 144px -apple-system, system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.fillText('ARROW', 540, 800);
ctx.fillText('ESCAPE', 540, 960);
ctx.font = '500 21px -apple-system, system-ui, sans-serif';
ctx.fillText(VERSION, 540, 1880);
