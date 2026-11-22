import { xf, } from '../functions.js';
import config from './config.js';

// Garmin Connect upload through the self-hosted server (home only).
// The server keeps the Garmin login, so there is no connect flow here.
function Garmin(args = {}) {
    const api_uri = config.get().API_URI;

    async function uploadWorkout(record) {
        const blob = record.blob;
        const workoutName = record.summary?.name ?? 'Powered by Auuki workout';
        const url = `${api_uri}/api/garmin/upload`;

        const formData = new FormData();
        formData.append('file', blob);
        formData.append('name', workoutName);

        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            if(response.ok) return ':success';
            console.log(`:garmin :upload :fail ${response.status}`);
            return ':fail';
        } catch(e) {
            console.log(`:garmin :upload :error `, e);
            return ':fail';
        }
    }

    return Object.freeze({
        uploadWorkout,
    });
}

const garmin = Garmin();

export default garmin;
