import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} from '@whiskeysockets/baileys';
import { upload } from './mega.js';

const router = express.Router();

function removeFile(path) {
    try {
        if (fs.existsSync(path)) {
            fs.rmSync(path, { recursive: true, force: true });
            console.log('Fichier supprimé :', path);
        }
    } catch (err) {
        console.error('Erreur suppression fichier :', err);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num || !/^\+?\d{10,15}$/.test(num)) {
        return res.status(400).send({ error: 'Numéro invalide ou manquant' });
    }

    num = num.replace(/[^0-9]/g, '');
    const sessionDir = `./session-${num}`;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }),
                browser: Browsers.macOS('Safari'),
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                console.log('Mise à jour connexion :', connection);

                if (connection === 'open') {
                    console.log('Connexion établie avec succès !');

                    await delay(10000);

                    const randomId = Math.random().toString(36).substring(2, 8).toUpperCase() + Math.floor(Math.random() * 10000);
                    const credsPath = `${sessionDir}/creds.json`;

                    if (!fs.existsSync(credsPath)) {
                        console.error('Fichier creds.json introuvable');
                        return;
                    }

                    const megaUrl = await upload(fs.createReadStream(credsPath), `${randomId}.json`);
                    const stringSession = 'DRKAMRAN-MD~' + megaUrl.replace('https://mega.nz/file/', '');

                    const jid = jidNormalizedUser(num + '@s.whatsapp.net');

                    await sock.sendMessage(jid, { text: stringSession });
                    await sock.sendMessage(jid, {
                        text: `HELLO THERE! 👋\n\nDO NOT SHARE YOUR SESSION ID WITH ANYONE.\n\nPUT THE ABOVE IN SESSION_ID VAR\n\nTHANKS FOR USING DRKAMRAN-MD BOT\n\nJOIN SUPPORT CHANNEL: https://whatsapp.com/channel/0029Vb6mAlz5K3zMSP0TQq3X`
                    });

                    console.log('Session envoyée avec succès à :', num);

                    await delay(2000);
                    removeFile(sessionDir);
                    process.exit(0);
                }

                if (connection === 'close') {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                    console.log('Connexion fermée.', shouldReconnect ? 'Reconnexion...' : 'Non autorisé');
                    if (shouldReconnect) await initiateSession();
                }
            });

            if (!state.creds.registered) {
                await delay(1000);
                const code = await sock.requestPairingCode(num);
                console.log('Code de jumelage pour', num, ':', code);

                if (!res.headersSent) {
                    return res.status(200).send({ code });
                }
            }

        } catch (err) {
            console.error('Erreur durant la session :', err);
            if (!res.headersSent) {
                return res.status(500).send({ error: 'Erreur serveur' });
            }
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    console.error('Exception non gérée :', err);
});

export default router;