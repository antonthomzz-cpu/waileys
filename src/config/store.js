export const sessions = new Map();

export function create_session(userId) {
    userId = String(userId);

    if (sessions.has(userId)) {
        return sessions.get(userId);
    }

    const session = {
        userId,

        sock: null,

        ready: false,
        starting: false,
        syncing: false,

        // Cache media hanya untuk runtime
        media: new Map(),

        // Timer typing hanya untuk runtime
        typingTimers: new Map()
    };

    sessions.set(userId, session);

    return session;
}

export function get_session(userId) {
    userId = String(userId);

    let session = sessions.get(userId);

    if (session) {
        return session;
    }

    return create_session(userId);
}