const {test}=require('node:test'),assert=require('node:assert/strict');
const {graphicxInsertion,documentBodyStart,imageTex}=require('../dist/image-paste');
const begin='\\begin{document}';
test('graphicx insertion ignores commented commands and preserves root offsets',()=>{
 const root='% \\usepackage{graphicx}\n\\documentclass{article}\n  '+begin+'\nBody';const change=graphicxInsertion(root);assert.equal(root.slice(change.from).trimStart().slice(0,begin.length),begin);assert.equal(change.insert,'\\usepackage{graphicx}\n');assert.equal(documentBodyStart(root),root.indexOf(begin)+begin.length);
});
test('existing package options and package lists are retained',()=>{
 for(const command of ['\\usepackage[demo]{graphicx}','\\RequirePackage{amsmath, graphicx }','\\usepackage\n [draft]\n {graphicx}'])assert.equal(graphicxInsertion(command+'\n'+begin),undefined);
 assert.ok(graphicxInsertion(begin+'\n\\usepackage{graphicx}'));
});
test('escaped percent signs and commented document openings do not confuse detection',()=>{
 const root='\\documentclass{article} % '+begin+'\n\\def\\percent{\\%}\\usepackage{graphicx}\n'+begin;assert.equal(graphicxInsertion(root),undefined);assert.equal(documentBodyStart(root),root.lastIndexOf(begin)+begin.length);assert.throws(()=>documentBodyStart('% '+begin),/needs/);
});
test('inline document opening gets a valid package boundary',()=>{
 const root='\\documentclass{article}'+begin,change=graphicxInsertion(root);assert.equal(root.slice(0,change.from)+change.insert+root.slice(change.from),'\\documentclass{article}\\usepackage{graphicx}\n'+begin);
});
test('image source uses a portable generated path and rejects TeX or path injection',()=>{
 assert.equal(imageTex('images/pasted-image-20261023-ab12.png'),'\n\\includegraphics[width=0.8\\linewidth]{images/pasted-image-20261023-ab12.png}\n');for(const name of ['../other.png','images/x}.png','C:/image.png','images/pasted-image-a\\b.png'])assert.throws(()=>imageTex(name),/Invalid/);
});
