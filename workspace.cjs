const fs=require('node:fs');
const path=require('node:path');
function validateWorkspace(workspace,roots){
 if(!path.isAbsolute(workspace))throw Error('workspace must be an absolute path.');
 const target=fs.realpathSync(workspace);
 if(!fs.statSync(target).isDirectory())throw Error('workspace must be a directory.');
 if(!Array.isArray(roots)||roots.length===0||roots.some(root=>typeof root!=='string'||!root))throw Error('Configure ZCODE_BRIDGE_ALLOWED_ROOTS.');
 // Explicit opt-in: all existing directories, including other drives and UNC.
 // This routing policy does not grant OS permissions or widen the task scope.
 if(roots.includes('*'))return target;
 if(!roots.some(root=>{const relative=path.relative(fs.realpathSync(root),target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}))throw Error('workspace is outside ZCODE_BRIDGE_ALLOWED_ROOTS.');
 return target;
}
module.exports={validateWorkspace};
