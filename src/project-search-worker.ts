import {parentPort,workerData} from 'node:worker_threads';
import {scanProject} from './project-search';
scanProject(workerData.folders,workerData.docs,workerData.options).then(result=>parentPort!.postMessage(result),error=>parentPort!.postMessage({error:String(error)}));
