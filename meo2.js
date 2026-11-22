// meo2 additions for the newer server features: reactions, stickers, pins,
// DM requests, group invites, friends, roles & permissions, bans, chat
// purposes, data export and reports. Loaded after script.js; it extends
// meo's own functions rather than replacing its look.

const meoUser = () => localStorage.getItem("username");

const MEO_ERRORS = {
    missingPermission: "You don't have permission to do that.",
    insufficientRank: "You can't do that to someone ranked at or above you.",
    permissionAboveRoleTier: "That permission is above this role's tier.",
    invitesDisabled: "Invites are turned off in this chat.",
    nameTaken: "That name is already used in this chat.",
    tooManyReactions: "This post has too many reactions.",
    invalidCredentials: "Wrong password.",
};

async function meoApi(path, method = "GET", body) {
    const headers = {token: localStorage.getItem("token")};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const resp = await fetch(API_URL + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = {};
    try { json = await resp.json(); } catch (e) {}
    if (!resp.ok) {
        throw new Error(MEO_ERRORS[json.type] ||
            (resp.status === 429 ? "Too many requests! Try again later." : json.type || `Error ${resp.status}`));
    }
    return json;
}

function meoEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

// Show content in meo's shared modal
function meoModal(title, body, buttons = "") {
    document.documentElement.style.overflow = "hidden";
    const back = document.querySelector(".modal-back");
    back.style.display = "flex";
    const mdl = back.querySelector(".modal");
    mdl.id = "mdl-meo2";
    mdl.querySelector(".modal-top").innerHTML = `<h3 class="mdl-title-stick">${title}</h3>${body}`;
    mdl.querySelector(".modal-bottom").innerHTML = buttons;
    return mdl;
}

async function meoTry(fn, after) {
    try {
        const r = await fn();
        if (after) after(r);
        return r;
    } catch (e) {
        openUpdate(meoEsc(e.message || e));
    }
}

// ---------------------------------------------------------------------------
// Group chat permissions (mirrors the server's chat_permissions.py)
// ---------------------------------------------------------------------------
const MEO_PERMS = [
    ["send_messages", 0, "Send messages"],
    ["delete_own_messages", 0, "Delete own messages"],
    ["invite_members", 0, "Invite members"],
    ["add_emotes", 0, "Add emojis & stickers"],
    ["edit_emotes", 0, "Edit emojis & stickers"],
    ["delete_emotes", 0, "Delete emojis & stickers"],
    ["change_color", 0, "Change chat colour"],
    ["change_name", 0, "Change chat name"],
    ["change_icon", 0, "Change chat icon"],
    ["delete_icon", 0, "Remove chat icon"],
    ["pin_messages", 0, "Pin messages"],
    ["unpin_messages", 0, "Unpin messages"],
    ["add_reactions", 0, "Add reactions"],
    ["delete_others_messages", 1, "Delete others' messages"],
    ["remove_members", 1, "Remove members"],
    ["ban_members", 2, "Ban members"],
    ["modify_roles", 2, "Edit roles"],
    ["assign_roles", 2, "Assign roles"],
    ["change_settings", 3, "Change chat settings"],
    ["create_roles", 3, "Create roles"],
    ["delete_roles", 3, "Delete roles"],
    ["toggle_invites", 3, "Turn invites on/off"],
];
const MEO_PERM_TIER = Object.fromEntries(MEO_PERMS.map(([k, t]) => [k, t]));

const meoIsGroup = chat => chat && chat.type === 0 && chat._id !== "livechat";
const meoRoles = chat => Object.fromEntries((chat.roles || []).map(r => [r._id, r]));

function meoRoleEffective(chat, role) {
    if (role.tier >= 4) return new Set(Object.keys(MEO_PERM_TIER));
    const eff = new Set();
    for (const other of chat.roles || []) {
        if (other.tier < role.tier) {
            for (const [k, v] of Object.entries(other.permissions || {})) if (v === true) eff.add(k);
        }
    }
    for (const [k, v] of Object.entries(role.permissions || {})) if (v === true) eff.add(k);
    for (const [k, v] of Object.entries(role.permissions || {})) if (v === false) eff.delete(k);
    return eff;
}

function meoHas(chat, username, perm) {
    if (!meoIsGroup(chat)) return true;
    if (username === chat.owner) return true;
    if (!(chat.members || []).includes(username)) return false;
    const roles = meoRoles(chat);
    return (chat.member_roles?.[username] || []).some(id => roles[id] && meoRoleEffective(chat, roles[id]).has(perm));
}

function meoRank(chat, username) {
    if (username === chat.owner) return 5;
    const roles = meoRoles(chat);
    const tiers = (chat.member_roles?.[username] || []).filter(id => roles[id]).map(id => roles[id].tier);
    return tiers.length ? Math.max(...tiers) : -1;
}

const meoOutranks = (chat, a, b) => meoRank(chat, a) > meoRank(chat, b);

function meoCanManageRole(chat, actor, role) {
    if (role._id === "administrator") return false;
    if (chat.owner === actor || meoRank(chat, actor) >= 4) return true;
    return role.tier < meoRank(chat, actor);
}

function meoCanGrant(chat, actor, perm) {
    if (chat.owner === actor || meoRank(chat, actor) >= 4) return true;
    return MEO_PERM_TIER[perm] < meoRank(chat, actor);
}

function meoCanAssign(chat, actor, target, role) {
    if (!meoHas(chat, actor, "assign_roles")) return false;
    if (actor !== chat.owner && (actor === target || !meoOutranks(chat, actor, target))) return false;
    if (role._id === "administrator") return actor === chat.owner && target !== chat.owner;
    return meoCanManageRole(chat, actor, role);
}

// The member's highest-tier role (ties: most recently given)
function meoTopRole(chat, username, needColor = false) {
    const roles = meoRoles(chat);
    let best = null;
    for (const id of chat.member_roles?.[username] || []) {
        const r = roles[id];
        if (!r || (needColor && !(r.colors || []).length)) continue;
        if (!best || r.tier >= best.tier) best = r;
    }
    return best;
}

function meoColorStyle(colors) {
    if (!colors || !colors.length) return "";
    if (colors.length === 1) return `color: #${colors[0]};`;
    return `background-image: linear-gradient(90deg, #${colors[0]}, #${colors[1]}); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;`;
}

// ---------------------------------------------------------------------------
// Live events (called from script.js for every websocket packet)
// ---------------------------------------------------------------------------
function meo2Handle(packet) {
    const {cmd, val} = packet;
    if (cmd === "post_reaction_add" || cmd === "post_reaction_remove") {
        const adding = cmd === "post_reaction_add";
        const post = (postCache[val.chat_id] || []).find(p => p._id === val.post_id);
        if (!post) return;
        post.reactions = post.reactions || [];
        const mine = val.username === meoUser();
        let r = post.reactions.find(x => x.emoji === val.emoji);
        if (r) {
            // our own clicks are applied straight away
            if (!(mine && r.user_reacted === adding)) {
                r.count += adding ? 1 : -1;
                if (mine) r.user_reacted = adding;
            }
        } else if (adding) {
            post.reactions.push({emoji: val.emoji, count: 1, user_reacted: mine});
        }
        post.reactions = post.reactions.filter(x => x.count > 0);
        meoRenderReactions(post);
    } else if (cmd === "update_chat" && val && val._id === page) {
        // roles, permissions or a DM request changed in the open chat
        if ("roles" in val || "member_roles" in val || "dm_request" in val || "invites_enabled" in val) {
            meoDecorateChat(page);
            document.querySelectorAll("#msgs .post").forEach(el => {
                const p = (postCache[page] || []).find(x => x._id === el.id);
                if (p) meoDecoratePost(p);
            });
        }
    } else if (cmd === "post" && val && val.post_origin === page && chatCache[page]?.dm_request) {
        // the request state changes once the first message is sent
        meoApi(`/chats/${page}`).then(chat => {
            chatCache[chat._id] = chat;
            meoDecorateChat(chat._id);
        }).catch(() => {});
    } else if (cmd === "create_chat") {
        if (page === "start") meoRenderInvites();
    }
}

// ---------------------------------------------------------------------------
// Posts: reactions, stickers, pins, role colours, permission-aware delete
// ---------------------------------------------------------------------------
const meoCustomId = e => /^[A-Za-z0-9]{24}$/.test(e);

function meoReactionHtml(emoji) {
    return meoCustomId(emoji)
        ? `<img class="meo-reaction-emoji" src="${UPLOADS_URL}/emojis/${emoji}" alt="emoji">`
        : `<span class="meo-reaction-emoji">${meoEsc(emoji)}</span>`;
}

function meoCanReact(post) {
    const chat = chatCache[post.post_origin];
    return post.u !== "Server" && post.post_origin !== "livechat" &&
        (!meoIsGroup(chat) || meoHas(chat, meoUser(), "add_reactions"));
}

function meoRenderReactions(post) {
    const el = document.getElementById(post._id);
    if (!el) return;
    const wrapper = el.querySelector(".wrapper");
    let row = el.querySelector(".meo-reactions");
    if (!(post.reactions || []).length) {
        if (row) row.remove();
        return;
    }
    if (!row) {
        row = document.createElement("div");
        row.className = "meo-reactions";
        wrapper.appendChild(row);
    }
    const canReact = meoCanReact(post);
    row.innerHTML = post.reactions.map(r => `
        <button class="meo-reaction${r.user_reacted ? " mine" : ""}" ${!canReact && !r.user_reacted ? "disabled" : ""}
            onclick="meoToggleReaction('${post._id}', '${meoEsc(r.emoji)}')"
            onmouseenter="meoReactors(this, '${post._id}', '${meoEsc(r.emoji)}')">
            ${meoReactionHtml(r.emoji)}<span>${r.count}</span>
        </button>`).join("");
}

function meoFindPost(postId) {
    for (const list of Object.values(postCache)) {
        const p = (list || []).find(x => x._id === postId);
        if (p) return p;
    }
    return null;
}

async function meoToggleReaction(postId, emoji) {
    const post = meoFindPost(postId);
    if (!post) return;
    post.reactions = post.reactions || [];
    let r = post.reactions.find(x => x.emoji === emoji);
    const adding = !(r && r.user_reacted);
    const before = JSON.parse(JSON.stringify(post.reactions));
    if (r) {
        r.count += adding ? 1 : -1;
        r.user_reacted = adding;
    } else {
        post.reactions.push({emoji, count: 1, user_reacted: true});
    }
    post.reactions = post.reactions.filter(x => x.count > 0);
    meoRenderReactions(post);
    try {
        await meoApi(`/posts/${postId}/reactions/${encodeURIComponent(emoji)}${adding ? "" : "/@me"}`, adding ? "POST" : "DELETE");
    } catch (e) {
        post.reactions = before;
        meoRenderReactions(post);
        openUpdate(meoEsc(e.message));
    }
}

async function meoReactors(btn, postId, emoji) {
    if (btn.title) return;
    btn.title = "...";
    try {
        const data = await meoApi(`/posts/${postId}/reactions/${encodeURIComponent(emoji)}`);
        btn.title = (data.autoget || []).map(u => u._id).join(", ");
    } catch (e) {
        btn.title = "";
    }
}

// The emoji picker reports picks through addemoji(); while a target is set
// the pick goes to it instead of the message box.
let meoEmojiTarget = null;
const meoOrigAddemoji = addemoji;
addemoji = function (emoji) {
    if (meoEmojiTarget) {
        const target = meoEmojiTarget;
        meoEmojiTarget = null;
        const custom = String(emoji).match(/^<:([A-Za-z0-9]{24})>$/);
        closemodal();
        if (typeof closepicker === "function") closepicker();
        target(custom ? custom[1] : emoji);
        return;
    }
    return meoOrigAddemoji(emoji);
};

function meoReact(postId) {
    meoEmojiTarget = emoji => meoToggleReaction(postId, emoji);
    emojimodal();
}

function meoCanPin(post) {
    const chat = chatCache[post.post_origin];
    if (!chat || !meoIsGroup(chat)) return false;
    return meoHas(chat, meoUser(), post.pinned ? "unpin_messages" : "pin_messages");
}

function meoCanDeleteOthers(post) {
    const chat = chatCache[post.post_origin];
    if (!meoIsGroup(chat) || post.u === meoUser()) return false;
    if (post.u === "Server") return meoRank(chat, meoUser()) >= 4;
    return meoHas(chat, meoUser(), "delete_others_messages") && meoOutranks(chat, meoUser(), post.u);
}

async function meoPin(postId) {
    const post = meoFindPost(postId);
    if (!post) return;
    await meoTry(() => meoApi(`/posts/${postId}/pin`, post.pinned ? "DELETE" : "POST"), () => {
        post.pinned = !post.pinned;
        closemodal(post.pinned ? "Pinned!" : "Unpinned.");
        meoDecoratePost(post);
    });
}

function meoDeleteOthers(postId) {
    meoModal("Delete message?", `<span>This deletes someone else's message for everyone.</span>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoTry(() => meoApi('/posts?id=${postId}', 'DELETE'), () => closemodal())">Delete</button>`);
}

const MEO_ICONS = {
    react: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg>`,
    pin: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
    trash: `<svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15Z"></path><path fill="currentColor" d="M5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z"></path></svg>`,
    sticker: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/></svg>`,
};

function meoToolButton(cls, title, onclick, icon) {
    const b = document.createElement("div");
    b.className = `toolButton tooltip ${cls}`;
    b.setAttribute("onclick", onclick);
    b.setAttribute("title", title);
    b.setAttribute("aria-label", title);
    b.setAttribute("data-tooltip", title);
    b.setAttribute("tabindex", "0");
    b.innerHTML = icon;
    return b;
}

function meoDecoratePost(p) {
    const el = document.getElementById(p._id);
    if (!el) return;
    const chat = chatCache[p.post_origin];

    // role colour on the author's name
    const name = el.querySelector(".user-header #username");
    if (name) {
        const role = meoIsGroup(chat) ? meoTopRole(chat, p.u, true) : null;
        name.setAttribute("style", role ? meoColorStyle(role.colors) : "");
    }

    // stickers
    if ((p.stickers || []).length && !el.querySelector(".meo-stickers")) {
        const s = document.createElement("div");
        s.className = "meo-stickers";
        s.innerHTML = p.stickers.map(st => {
            const id = st._id || st;
            return `<img class="meo-sticker" src="${UPLOADS_URL}/stickers/${id}" alt="${meoEsc(st.name || "Sticker")}" title="${meoEsc(st.name || "")}">`;
        }).join("");
        el.querySelector(".wrapper").appendChild(s);
    }

    meoRenderReactions(p);

    // extra toolbar buttons
    const bar = el.querySelector(".buttonContainer .toolbarContainer");
    if (bar && p.post_origin !== "livechat") {
        bar.querySelectorAll(".meo-tool").forEach(b => b.remove());
        if (meoCanReact(p) && p.post_origin !== "inbox") {
            bar.append(meoToolButton("meo-tool", "React", `meoReact('${p._id}')`, MEO_ICONS.react));
        }
        if (meoCanPin(p)) {
            bar.append(meoToolButton("meo-tool", p.pinned ? "Unpin" : "Pin", `meoPin('${p._id}')`, MEO_ICONS.pin));
        }
        if (meoCanDeleteOthers(p)) {
            bar.prepend(meoToolButton("meo-tool", "Delete", `meoDeleteOthers('${p._id}')`, MEO_ICONS.trash));
        }
    }
}

const meoOrigLoadpost = loadpost;
loadpost = function (p) {
    const r = meoOrigLoadpost(p);
    try { meoDecoratePost(p); } catch (e) { console.error("meo2 post decoration failed", e); }
    return r;
};

// Extra actions in the post menu (mobile and "more")
const meoOrigOpenModal = openModal;
openModal = function (postId) {
    meoOrigOpenModal(postId);
    const post = meoFindPost(postId);
    const top = document.querySelector(".modal .modal-top");
    if (!post || !top) return;
    const add = (label, onclick, icon) => {
        top.insertAdjacentHTML("beforeend", `<button class="modal-button" onclick="${onclick}"><div>${label}</div><div class="modal-icon">${icon}</div></button>`);
    };
    if (meoCanReact(post) && post.post_origin !== "inbox") add("React", `meoReact('${postId}')`, MEO_ICONS.react);
    if (meoCanPin(post)) add(post.pinned ? "Unpin" : "Pin", `meoPin('${postId}')`, MEO_ICONS.pin);
    if (meoCanDeleteOthers(post)) add("Delete", `meoDeleteOthers('${postId}')`, MEO_ICONS.trash);
};


// ---------------------------------------------------------------------------
// Chat pages: DM requests, stickers, pins, send permission
// ---------------------------------------------------------------------------
function meoDecorateChat(chatId) {
    const chat = chatCache[chatId];
    if (!chat || page !== chatId) return;
    const main = document.getElementById("main");
    if (!main) return;
    main.querySelectorAll(".meo-chat-note").forEach(n => n.remove());
    const outer = main.querySelector(".message-outer");
    const container = main.querySelector(".message-container");

    // Pinned posts button in the chat sidebar
    const navTop = document.querySelector(".nav-top");
    if (meoIsGroup(chat) && navTop && !navTop.querySelector(".meo-pins-btn")) {
        navTop.insertAdjacentHTML("beforeend",
            `<input type="button" class="settings-button button meo-pins-btn" value="Pinned" onclick="meoShowPins('${chatId}')">`);
    }

    // DM requests
    const req = chat.type === 1 ? chat.dm_request : null;
    const other = (chat.members || []).find(m => m !== meoUser());
    if (req && !req.from && !req.first_message_sent) {
        // new request: the sender gets one text-only message
        if (outer) outer.style.display = "";
        outer?.insertAdjacentHTML("beforebegin",
            `<p class="meo-chat-note">You can send 1 message (no images) as a message request. @${meoEsc(other)} will need to accept it before you can keep chatting.</p>`);
        container?.querySelector("#attach")?.remove();
        container?.querySelector(".meo-sticker-btn")?.remove();
        return;
    }
    if (req && req.from) {
        if (req.to === meoUser()) {
            if (outer) outer.style.display = "none";
            main.querySelector(".info")?.insertAdjacentHTML("afterend", `
                <div class="meo-chat-note meo-request">
                    <p><b>@${meoEsc(req.from)}</b> sent you a message request.</p>
                    <div class="meo-request-btns">
                        <button class="settings-button-in" onclick="meoIgnoreRequest('${chatId}')">Ignore</button>
                        <button class="settings-button-in red" onclick="meoBlockRequest('${chatId}', '${meoEsc(req.from)}')">Block</button>
                        <button class="settings-button-in green" onclick="meoAcceptRequest('${chatId}')">Accept</button>
                    </div>
                </div>`);
        } else if (req.first_message_sent) {
            if (outer) outer.style.display = "none";
            main.querySelector(".info")?.insertAdjacentHTML("afterend",
                `<p class="meo-chat-note">Message request sent. You can keep chatting once @${meoEsc(req.to)} accepts.</p>`);
        } else {
            if (outer) outer.style.display = "";
            outer?.insertAdjacentHTML("beforebegin",
                `<p class="meo-chat-note">You can send 1 message (no images) as a message request. @${meoEsc(req.to)} will need to accept it before you can keep chatting.</p>`);
            container?.querySelector("#attach")?.remove();
            container?.querySelector(".meo-sticker-btn")?.remove();
        }
        return;
    }

    // No permission to send in a group chat
    if (meoIsGroup(chat) && !meoHas(chat, meoUser(), "send_messages")) {
        if (outer) outer.style.display = "none";
        main.querySelector(".info")?.insertAdjacentHTML("afterend",
            `<p class="meo-chat-note">You don't have permission to send messages here.</p>`);
    } else if (outer) {
        outer.style.display = "";
    }
}

const meoOrigLoadchat = loadchat;
loadchat = function (chatId) {
    const r = meoOrigLoadchat(chatId);
    try { meoDecorateChat(chatId); } catch (e) { console.error("meo2 chat decoration failed", e); }
    return r;
};

async function meoAcceptRequest(chatId) {
    await meoTry(() => meoApi(`/chats/${chatId}/dm_request/accept`, "POST"), () => {
        chatCache[chatId].dm_request = null;
        loadchat(chatId);
    });
}

function meoIgnoreRequest(chatId) {
    const from = chatCache[chatId]?.dm_request?.from;
    meoModal("Ignore message request?", `<span>@${meoEsc(from)}'s request will be removed from your chats.</span>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoDoIgnore('${chatId}')">Ignore</button>`);
}

async function meoDoIgnore(chatId) {
    await meoTry(() => meoApi(`/chats/${chatId}/dm_request/ignore`, "POST"), () => {
        delete chatCache[chatId];
        closemodal();
        renderChats();
        loadstart();
    });
}

function meoBlockRequest(chatId, username) {
    meoModal(`Block @${meoEsc(username)}?`, `
        <span>They won't be able to message you.</span>
        <label class="meo-check"><input type="checkbox" id="meo-block-notify"> Let them know they've been blocked</label>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoDoBlock('${chatId}', '${meoEsc(username)}')">Block</button>`);
}

async function meoDoBlock(chatId, username) {
    const notify = document.getElementById("meo-block-notify")?.checked || false;
    await meoTry(() => meoApi(`/users/${username}/relationship`, "PATCH", {state: 2, notify}), () => {
        blockedUsers[username] = true;
        delete chatCache[chatId];
        closemodal();
        renderChats();
        loadstart();
    });
}

async function meoShowPins(chatId) {
    meoModal("Pinned", `<div class="meo-list"><span>Loading...</span></div>`);
    try {
        const data = await meoApi(`/chats/${chatId}/pins`);
        const list = document.querySelector("#mdl-meo2 .meo-list");
        if (!list) return;
        const posts = data.autoget || [];
        list.innerHTML = posts.length ? posts.map(p => `
            <div class="meo-pin">
                <b>@${meoEsc(p.u)}</b> <i class="date">${new Date(p.t.e * 1000).toLocaleString([], {month: "2-digit", day: "2-digit", year: "2-digit", hour: "numeric", minute: "numeric"})}</i>
                <div>${meoEsc(p.p).slice(0, 300) || "<i>Attachment</i>"}</div>
            </div>`).join("") : "<span>Nothing pinned yet.</span>";
    } catch (e) {
        openUpdate(meoEsc(e.message));
    }
}

// Stickers live in the emoji picker, in each chat's section, and can be
// sent anywhere you can post (home, group chats, DMs).
function meoAppendStickers(section, chat) {
    const stickers = chat.stickers || [];
    if (!stickers.length || meoEmojiTarget) return;
    // own header and grid, spanning the section (meo pins .emojiheader on mobile)
    const header = document.createElement("div");
    header.className = "meo-sticker-header";
    header.textContent = "Stickers";
    section.appendChild(header);
    const grid = document.createElement("div");
    grid.className = "meo-sticker-grid";
    for (const s of stickers) {
        const btn = document.createElement("button");
        btn.className = "emojibutton meo-sticker-pick";
        btn.title = s.name;
        btn.onclick = () => meoSendStickerHere(s._id);
        const img = document.createElement("img");
        img.src = `${UPLOADS_URL}/stickers/${s._id}`;
        img.alt = s.name;
        btn.appendChild(img);
        grid.appendChild(btn);
    }
    section.appendChild(grid);
}

async function meoSendStickerHere(stickerId) {
    if (typeof closepicker === "function") closepicker();
    closemodal();
    const target = page === "home" ? "/home" : chatCache[page] ? `/posts/${page}` : null;
    if (!target) {
        openUpdate("Open a chat or Home to send stickers.");
        return;
    }
    await meoTry(() => meoApi(target, "POST", {content: "", stickers: [stickerId]}));
}

function meoStickerPicker(chatId) {
    const chat = chatCache[chatId];
    const stickers = chat.stickers || [];
    meoModal("Stickers", stickers.length
        ? `<div class="meo-sticker-grid">${stickers.map(s => `
            <button class="meo-sticker-option" onclick="meoSendSticker('${chatId}', '${s._id}')" title="${meoEsc(s.name)}">
                <img src="${UPLOADS_URL}/stickers/${s._id}" alt="${meoEsc(s.name)}">
            </button>`).join("")}</div>`
        : `<span>No stickers in this chat yet.</span>`,
        "");
}

async function meoSendSticker(chatId, stickerId) {
    closemodal();
    await meoTry(() => meoApi(`/posts/${chatId}`, "POST", {content: "", stickers: [stickerId]}));
}

// ---------------------------------------------------------------------------
// Group chat invites (Start page)
// ---------------------------------------------------------------------------
async function meoRenderInvites() {
    const main = document.getElementById("main");
    if (!main || page !== "start") return;
    let invites = [];
    try {
        invites = (await meoApi("/invites")).autoget || [];
    } catch (e) {
        return;
    }
    main.querySelector(".meo-invites")?.remove();
    if (!invites.length || page !== "start") return;
    const box = document.createElement("div");
    box.className = "meo-invites";
    box.innerHTML = `<h3>Invites - ${invites.length}</h3>` + invites.map(inv => `
        <div class="meo-invite" id="invite-${inv._id}">
            <span><b>@${meoEsc(inv.from)}</b> invited you to <b>${meoEsc(inv.chat_nickname || "a group chat")}</b></span>
            <div class="meo-invite-btns">
                <button class="settings-button-in" onclick="meoDeclineInvite('${inv._id}')">Decline</button>
                <button class="settings-button-in green" onclick="meoAcceptInvite('${inv._id}', '${inv.chat_id}')">Accept</button>
            </div>
        </div>`).join("");
    const header = main.querySelector("h1, .header-top");
    if (header) header.after(box); else main.prepend(box);
}

async function meoAcceptInvite(inviteId, chatId) {
    await meoTry(() => meoApi(`/invites/${inviteId}/accept`, "POST"), async () => {
        try { chatCache[chatId] = await meoApi(`/chats/${chatId}`); } catch (e) {}
        renderChats();
        loadchat(chatId);
    });
}

async function meoDeclineInvite(inviteId) {
    await meoTry(() => meoApi(`/invites/${inviteId}`, "DELETE"), () => {
        document.getElementById(`invite-${inviteId}`)?.remove();
        if (!document.querySelector(".meo-invite")) document.querySelector(".meo-invites")?.remove();
    });
}

const meoOrigLoadstart = loadstart;
loadstart = function () {
    const r = meoOrigLoadstart();
    meoRenderInvites();
    return r;
};

// Adding a member now sends them an invite
addMembertoGC = async function (chatId) {
    const user = document.getElementById("chat-mem-input").value.trim();
    if (!user) return;
    await meoTry(() => meoApi(`/chats/${chatId}/invites`, "POST", {username: user}), () => {
        closemodal(`Invite sent to @${meoEsc(user)}.`);
    });
};

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
async function meoFriends() {
    return meoApi("/me/friends");
}

async function loadFriends() {
    page = "friends";
    pre = "friends";
    setTop();
    sidebars();
    const main = document.getElementById("main");
    main.innerHTML = `<div class="settings"><h1>Friends</h1>
        <div class="meo-add-friend">
            <input id="meo-friend-input" class="setting-input" placeholder="Add a friend by username" maxlength="20">
            <button class="settings-button-in green" onclick="meoSendFriendRequest()">Send request</button>
        </div>
        <div id="meo-friends"><span>Loading...</span></div></div>`;
    document.getElementById("meo-friend-input").addEventListener("keydown", e => {
        if (e.key === "Enter") meoSendFriendRequest();
    });
    let data;
    try { data = await meoFriends(); } catch (e) { openUpdate(meoEsc(e.message)); return; }
    const row = (u, buttons) => `
        <div class="member-in">
            <span class="meo-friend-name" onclick="openUsrModal('${u}')">@${meoEsc(u)}</span>
            <div class="meo-friend-btns">${buttons}</div>
        </div>`;
    const sec = (title, items) => items.length ? `<h3>${title} - ${items.length}</h3>${items.join("")}` : "";
    const out = [
        sec("Requests", data.incoming.map(u => row(u, `
            <button class="settings-button-in" onclick="meoSetRelationship('${u}', 0)">Decline</button>
            <button class="settings-button-in green" onclick="meoSetRelationship('${u}', 1)">Accept</button>`))),
        sec("Friends", data.friends.map(u => row(u, `
            <button class="settings-button-in" onclick="opendm('${u}')">Message</button>
            <button class="settings-button-in red" onclick="meoRemoveFriend('${u}')">Remove</button>`))),
        sec("Sent", data.outgoing.map(u => row(u, `
            <button class="settings-button-in" onclick="meoSetRelationship('${u}', 0)">Cancel</button>`))),
    ].join("");
    document.getElementById("meo-friends").innerHTML = out || "<span>No friends yet.</span>";
}

async function meoSetRelationship(username, state) {
    await meoTry(() => meoApi(`/users/${username}/relationship`, "PATCH", {state}), () => {
        if (page === "friends") loadFriends();
    });
}

function meoRemoveFriend(username) {
    meoModal(`Remove @${meoEsc(username)}?`, `<span>They'll be removed from your friends.</span>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="closemodal(); meoSetRelationship('${meoEsc(username)}', 0)">Remove</button>`);
}

async function meoSendFriendRequest() {
    const input = document.getElementById("meo-friend-input");
    const u = input.value.trim();
    if (!u) return;
    await meoTry(() => meoApi(`/users/${u}/relationship`, "PATCH", {state: 1}), () => {
        input.value = "";
        loadFriends();
    });
}

// Friends button in the sidebar
const meoOrigSidebars = sidebars;
sidebars = function () {
    const r = meoOrigSidebars();
    const inbox = document.querySelector("#nav #inbox");
    if (inbox && !document.querySelector("#nav #friends")) {
        inbox.insertAdjacentHTML("beforebegin",
            `<input type="button" class="navigation-button button" id="friends" value="Friends" onclick="loadFriends()" aria-label="friends" tabindex="0">`);
    }
    return r;
};

// Friend button on profiles
const meoOrigOpenUsrModal = openUsrModal;
openUsrModal = async function (username) {
    const r = meoOrigOpenUsrModal(username);
    if (!username || username === meoUser()) return r;
    let data;
    try { data = await meoFriends(); } catch (e) { return r; }
    const bottom = document.querySelector(".modal .modal-bottom");
    if (!bottom || bottom.querySelector(".meo-friend-action")) return r;
    let label, state;
    if (data.friends.includes(username)) { label = "Remove friend"; state = 0; }
    else if (data.outgoing.includes(username)) { label = "Cancel friend request"; state = 0; }
    else if (data.incoming.includes(username)) { label = "Accept friend request"; state = 1; }
    else if (!blockedUsers[username]) { label = "Add friend"; state = 1; }
    if (label) {
        bottom.insertAdjacentHTML("afterbegin",
            `<button class="modal-back-btn meo-friend-action" onclick="${state === 0 && data.friends.includes(username) ? `meoRemoveFriend('${username}')` : `closemodal(); meoSetRelationship('${username}', ${state})`}">${label}</button>`);
    }
    return r;
};

// ---------------------------------------------------------------------------
// Group chat settings: role-aware, plus stickers, roles and bans
// ---------------------------------------------------------------------------
async function meoEnsureChat(chatId) {
    if (!chatCache[chatId]) chatCache[chatId] = await meoApi(`/chats/${chatId}`);
    return chatCache[chatId];
}

function meoChatIcon(data) {
    const url = data.icon ? `url(${UPLOADS_URL}/icons/${data.icon})` : `url(images/GC.svg)`;
    const color = !data.icon ? "1f5831" : (data.icon_color || "000");
    return {url, color};
}

const MEO_SVG_EDIT = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12.86 6.55l.43-.43a2.42 2.42 0 0 0 0-3.42 2.42 2.42 0 0 0-3.42 0l-.43.43 3.42 3.42zM11.82 7.6L8.4 4.18 2.6 9.98c-.2.2-.33.45-.38.73l-.6 3.2c-.06.33.23.62.56.56l3.2-.6c.28-.05.53-.18.73-.38l5.71-5.89z"/></svg>`;
const MEO_SVG_X = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path fill="currentColor" d="M2.34 13.66a1.14 1.14 0 0 0 1.61 0L8 9.62l4.05 4.04a1.14 1.14 0 1 0 1.61-1.61L9.62 8l4.04-4.05a1.14 1.14 0 1 0-1.61-1.61L8 6.38 3.95 2.34a1.14 1.14 0 0 0-1.61 1.61L6.38 8l-4.04 4.05a1.14 1.14 0 0 0 0 1.61z"/></svg>`;

function meoEmoteRows(chatId, data, type) {
    const me = meoUser();
    const canEdit = meoHas(data, me, "edit_emotes");
    const canDelete = meoHas(data, me, "delete_emotes");
    return (data[type] || []).map(e => `
        <div class="member-in">
            <div class="emoji-option-in">
                <img class="emoji-option-im" src="${UPLOADS_URL}/${type}/${e._id}" alt="${meoEsc(e.name)}">
                <span>${meoEsc(e.name)}</span>
            </div>
            <div class="mem-ops">
                ${canEdit ? `<div class="mem-op tooltip left" title="Rename" data-tooltip="Rename" onclick="meoRenameEmote('${chatId}', '${type}', '${e._id}', '${meoEsc(e.name)}')">${MEO_SVG_EDIT}</div>` : ""}
                ${canDelete ? `<div class="mem-op tooltip left" title="Delete" data-tooltip="Delete" onclick="meoDeleteEmote('${chatId}', '${type}', '${e._id}', '${meoEsc(e.name)}')">${MEO_SVG_X}</div>` : ""}
            </div>
        </div>`).join("") || `<span class="subsubheader">None yet.</span>`;
}

chatSettings = async function (chatId) {
    setTop();
    let data;
    try { data = await meoEnsureChat(chatId); } catch (e) { openUpdate(`Unable to open chat: ${meoEsc(e.message)}`); return; }
    if (!meoIsGroup(data)) return;
    const me = meoUser();
    const can = p => meoHas(data, me, p);
    const {url, color} = meoChatIcon(data);
    const canEditGeneral = ["change_icon", "delete_icon", "change_color", "change_name", "change_settings", "toggle_invites"].some(can);
    const main = document.getElementById("main");
    main.innerHTML = `
    <div class="settings">
        <h1>${lang().chats.settings}</h1>
        <div class="avatar-big pfp-inner" style="border: 6px solid #${color}; background-color: #${color}; background-image: ${url};"></div>
        <div class="gctitle">
            <h2 id="nickname" class="gcn" onclick="copy('${meourl}?gc=${chatId}')">${escapeHTML(data.nickname)}</h2><i class="subtitle">${chatId}</i>
        </div>
        <hr class="mdl-hr">
        ${can("change_icon") || (can("delete_icon") && data.icon) ? `<h3>Chat Photo</h3><div class="meo-photo-row">` : ""}
        ${can("change_icon") ? `<label class="meo-file-btn">Choose photo<input type="file" id="chat-photo" accept="image/png,image/jpeg,image/webp,image/gif" onchange="this.parentElement.firstChild.textContent = this.files[0] ? this.files[0].name : 'Choose photo'"></label>` : ""}
        ${can("delete_icon") && data.icon ? `<button class="meo-file-btn" onclick="meoRemoveIcon('${chatId}')">Remove photo</button>` : ""}
        ${can("change_icon") || (can("delete_icon") && data.icon) ? `</div>` : ""}
        ${can("change_color") ? `<h3>Chat Color</h3><div class="color-outer"><input id="chat-color" type="color" value="#${data.icon_color || "000000"}"></div>` : ""}
        ${can("change_name") ? `<h3>${lang().action.nick}</h3><div class="nick"><input id="chat-nick-input" class="setting-input" placeholder="${escapeHTML(data.nickname)}" minlength="1" maxlength="32"></div>` : ""}
        ${can("change_settings") || can("toggle_invites") ? `<h3>Settings</h3>` : ""}
        ${can("change_settings") ? `
            <label class="meo-check"><input type="checkbox" id="meo-announce" ${data.announce_deletes ? "checked" : ""}> Announce deleted messages</label>
            <label class="meo-check"><input type="checkbox" id="meo-deleter" ${data.announce_deleter ? "checked" : ""}> Show who deleted them</label>` : ""}
        ${can("toggle_invites") ? `<label class="meo-check"><input type="checkbox" id="meo-invites" ${data.invites_enabled !== false ? "checked" : ""}> Allow invites</label>` : ""}
        ${canEditGeneral ? `<div class="settings-buttons-row"><button onclick="meoSaveChat('${chatId}')" id="chat-update" class="settings-button-in green">${lang().chats.update}</button></div>` : ""}
        <hr>
        <h3>${lang().chats.emojis}</h3>
        ${can("add_emotes") ? `<button class="member button" onclick="uploadEmojiModal('${chatId}')">${lang().chats.uploademoji}</button>` : ""}
        <div class="emoji-list">${meoEmoteRows(chatId, data, "emojis")}</div>
        <h3>Stickers</h3>
        ${can("add_emotes") ? `<button class="member button" onclick="meoUploadStickerModal('${chatId}')">Upload sticker</button>` : ""}
        <div class="emoji-list">${meoEmoteRows(chatId, data, "stickers")}</div>
        ${["modify_roles", "create_roles", "delete_roles"].some(can) ? `<hr><h3>Roles</h3><div id="meo-roles"></div>` : ""}
        ${can("ban_members") ? `<hr><h3>Bans</h3><div id="meo-bans"></div>` : ""}
    </div>`;
    meoRenderRoles(chatId);
    meoRenderBans(chatId);
};

async function meoSaveChat(chatId) {
    const data = chatCache[chatId];
    const me = meoUser();
    const body = {};
    const btn = document.getElementById("chat-update");
    btn.disabled = true;
    try {
        const file = document.getElementById("chat-photo")?.files[0];
        if (file && meoHas(data, me, "change_icon")) {
            const fd = new FormData();
            fd.append("file", file);
            const up = await fetch(UPLOADS_URL + "/icons", {method: "POST", headers: {Authorization: localStorage.getItem("token")}, body: fd});
            if (!up.ok) throw new Error("Failed to upload the photo");
            body.icon = (await up.json()).id;
        }
        const colorEl = document.getElementById("chat-color");
        if (colorEl && colorEl.value.slice(1) !== (data.icon_color || "000000")) body.icon_color = colorEl.value.slice(1);
        const nick = document.getElementById("chat-nick-input")?.value.trim();
        if (nick && nick !== data.nickname) body.nickname = nick;
        const a = document.getElementById("meo-announce"), d = document.getElementById("meo-deleter"), i = document.getElementById("meo-invites");
        if (a && a.checked !== !!data.announce_deletes) body.announce_deletes = a.checked;
        if (d && d.checked !== !!data.announce_deleter) body.announce_deleter = d.checked;
        if (i && i.checked !== (data.invites_enabled !== false)) body.invites_enabled = i.checked;
        if (!Object.keys(body).length) { btn.disabled = false; return; }
        const updated = await meoApi(`/chats/${chatId}`, "PATCH", body);
        Object.assign(chatCache[chatId], updated);
        openUpdate("Chat updated!");
        chatSettings(chatId);
    } catch (e) {
        openUpdate(meoEsc(e.message));
        btn.disabled = false;
    }
}

async function meoRemoveIcon(chatId) {
    await meoTry(() => meoApi(`/chats/${chatId}`, "PATCH", {icon: ""}), updated => {
        Object.assign(chatCache[chatId], updated, {icon: ""});
        chatSettings(chatId);
    });
}

function meoUploadStickerModal(chatId) {
    meoModal("Upload sticker", `
        <input type="file" id="meo-sticker-file" accept="image/png,image/jpeg,image/webp,image/gif">
        <input id="meo-sticker-name" class="mdl-inp" placeholder="Name" maxlength="32">`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" id="meo-sticker-upload" onclick="meoUploadSticker('${chatId}')">Upload</button>`);
}

async function meoUploadSticker(chatId) {
    const file = document.getElementById("meo-sticker-file").files[0];
    const name = document.getElementById("meo-sticker-name").value.trim();
    if (!file || !/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
        openUpdate("Pick an image and a name using letters, numbers, _ or -.");
        return;
    }
    document.getElementById("meo-sticker-upload").disabled = true;
    try {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch(UPLOADS_URL + "/stickers", {method: "POST", headers: {Authorization: localStorage.getItem("token")}, body: fd});
        if (!up.ok) throw new Error(up.status === 413 ? "That file is too big." : "Failed to upload the sticker");
        const id = (await up.json()).id;
        const sticker = await meoApi(`/chats/${chatId}/stickers/${id}`, "PUT", {name});
        chatCache[chatId].stickers = [...(chatCache[chatId].stickers || []), sticker];
        closemodal();
        chatSettings(chatId);
    } catch (e) {
        openUpdate(meoEsc(e.message));
    }
}

function meoRenameEmote(chatId, type, id, name) {
    meoModal("Rename", `<input id="meo-emote-name" class="mdl-inp" value="${meoEsc(name)}" maxlength="32">`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoDoRename('${chatId}', '${type}', '${id}')">Save</button>`);
}

async function meoDoRename(chatId, type, id) {
    const name = document.getElementById("meo-emote-name").value.trim();
    await meoTry(() => meoApi(`/chats/${chatId}/${type}/${id}`, "PATCH", {name}), updated => {
        const list = chatCache[chatId][type] || [];
        const e = list.find(x => x._id === id);
        if (e) e.name = updated.name || name;
        closemodal();
        chatSettings(chatId);
    });
}

function meoDeleteEmote(chatId, type, id, name) {
    meoModal(`Delete :${meoEsc(name)}:?`, `<span>It'll be removed from this chat for everyone.</span>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoDoDeleteEmote('${chatId}', '${type}', '${id}')">Delete</button>`);
}

async function meoDoDeleteEmote(chatId, type, id) {
    await meoTry(() => meoApi(`/chats/${chatId}/${type}/${id}`, "DELETE"), () => {
        chatCache[chatId][type] = (chatCache[chatId][type] || []).filter(x => x._id !== id);
        closemodal();
        chatSettings(chatId);
    });
}

// --- Roles -----------------------------------------------------------------
function meoSortedRoles(chat) {
    return (chat.roles || []).map((r, i) => [r, i]).sort((a, b) => b[0].tier - a[0].tier || a[1] - b[1]).map(([r]) => r);
}

function meoRenderRoles(chatId) {
    const box = document.getElementById("meo-roles");
    if (!box) return;
    const chat = chatCache[chatId];
    const me = meoUser();
    const myRank = meoRank(chat, me);
    const tiers = [0, 1, 2, 3].filter(t => chat.owner === me || myRank >= 4 || t < myRank);
    const count = r => Object.values(chat.member_roles || {}).filter(l => l.includes(r._id)).length;
    box.innerHTML = `
        ${meoHas(chat, me, "create_roles") && tiers.length ? `
        <div class="meo-role-create">
            <input id="meo-role-name" class="setting-input" placeholder="Role name" maxlength="32">
            <select id="meo-role-tier" class="setting-input">${tiers.map(t => `<option value="${t}">Tier ${t}</option>`).join("")}</select>
            <button class="settings-button-in green" onclick="meoCreateRole('${chatId}')">Create</button>
        </div>` : ""}
        ${meoSortedRoles(chat).map(r => `
        <div class="member-in meo-role-row" onclick="meoEditRole('${chatId}', '${r._id}')">
            <span><b style="${meoColorStyle(r.colors)}">${meoEsc(r.name)}</b> <span class="subsubheader">Tier ${r.tier} · ${count(r)} member${count(r) === 1 ? "" : "s"}</span></span>
            <div class="mem-ops">
                ${meoHas(chat, me, "delete_roles") && meoCanManageRole(chat, me, r) && !["default", "administrator"].includes(r._id)
                    ? `<div class="mem-op tooltip left" title="Delete" data-tooltip="Delete" onclick="event.stopPropagation(); meoDeleteRole('${chatId}', '${r._id}')">${MEO_SVG_X}</div>` : ""}
            </div>
        </div>`).join("")}`;
}

async function meoCreateRole(chatId) {
    const name = document.getElementById("meo-role-name").value.trim();
    const tier = Number(document.getElementById("meo-role-tier").value);
    if (!name) return;
    await meoTry(() => meoApi(`/chats/${chatId}/roles`, "POST", {name, tier, permissions: {}}), role => {
        delete role.error;
        chatCache[chatId].roles = [...(chatCache[chatId].roles || []), role];
        meoRenderRoles(chatId);
    });
}

function meoDeleteRole(chatId, roleId) {
    const role = meoRoles(chatCache[chatId])[roleId];
    meoModal(`Delete ${meoEsc(role.name)}?`, `<span>It'll be removed from every member who has it.</span>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoDoDeleteRole('${chatId}', '${roleId}')">Delete</button>`);
}

async function meoDoDeleteRole(chatId, roleId) {
    await meoTry(() => meoApi(`/chats/${chatId}/roles/${roleId}`, "DELETE"), () => {
        const chat = chatCache[chatId];
        chat.roles = chat.roles.filter(r => r._id !== roleId);
        for (const u in chat.member_roles || {}) chat.member_roles[u] = chat.member_roles[u].filter(id => id !== roleId);
        closemodal();
        meoRenderRoles(chatId);
    });
}

function meoEditRole(chatId, roleId) {
    const chat = chatCache[chatId];
    const role = meoRoles(chat)[roleId];
    const me = meoUser();
    const canManage = meoHas(chat, me, "modify_roles") && meoCanManageRole(chat, me, role);
    const canColor = role._id === "administrator" ? chat.owner === me : canManage;
    const colors = role.colors || [];
    const inherits = perm => (chat.roles || []).some(o => o.tier < role.tier && o.permissions?.[perm] === true);
    let perms = "";
    if (role._id === "administrator") {
        perms = `<p>Has every permission.</p>`;
    } else {
        for (let t = 0; t <= role.tier; t++) {
            const rows = MEO_PERMS.filter(([, tier]) => tier === t);
            if (!rows.length) continue;
            perms += `<h4 class="meo-tier">Tier ${t}</h4>` + rows.map(([key, , label]) => {
                const val = role.permissions?.[key] ?? null;
                const editable = canManage && meoCanGrant(chat, me, key);
                const seg = (lbl, v) => `<button class="meo-seg${val === v ? " selected" : ""}" ${editable ? "" : "disabled"} onclick="meoSetRolePerm('${chatId}', '${roleId}', '${key}', ${v === null ? "null" : v})">${lbl}</button>`;
                return `<div class="meo-perm"><span>${label}${val === null ? ` <i class="subsubheader">(${inherits(key) ? "on" : "off"})</i>` : ""}</span>
                    <div class="meo-segs">${seg("Deny", false)}${seg("Inherit", null)}${seg("Allow", true)}</div></div>`;
            }).join("");
        }
    }
    meoModal(meoEsc(role.name), `
        <div class="meo-role-editor">
            ${canManage ? `<input id="meo-role-rename" class="mdl-inp" value="${meoEsc(role.name)}" maxlength="32" onchange="meoRenameRole('${chatId}', '${roleId}', this.value)">` : ""}
            <div class="meo-role-colors">
                <b>Colour</b>
                <input type="color" id="meo-color-1" value="#${colors[0] || "765dee"}" ${canColor ? "" : "disabled"} onchange="meoSaveRoleColors('${chatId}', '${roleId}')">
                ${colors.length === 2 ? `<input type="color" id="meo-color-2" value="#${colors[1]}" ${canColor ? "" : "disabled"} onchange="meoSaveRoleColors('${chatId}', '${roleId}')">` : ""}
                ${canColor ? `<label class="meo-check"><input type="checkbox" ${colors.length === 2 ? "checked" : ""} onchange="meoToggleGradient('${chatId}', '${roleId}', this.checked)"> Gradient</label>
                ${colors.length ? `<button class="member button" onclick="meoSetRoleColors('${chatId}', '${roleId}', [])">Clear</button>` : ""}` : ""}
            </div>
            ${perms}
        </div>`,
        "");
}

async function meoPatchRole(chatId, roleId, body) {
    const updated = await meoApi(`/chats/${chatId}/roles/${roleId}`, "PATCH", body);
    delete updated.error;
    const chat = chatCache[chatId];
    chat.roles = chat.roles.map(r => r._id === roleId ? updated : r);
    meoRenderRoles(chatId);
}

async function meoSetRolePerm(chatId, roleId, key, value) {
    await meoTry(() => meoPatchRole(chatId, roleId, {permissions: {[key]: value}}), () => meoEditRole(chatId, roleId));
}

async function meoRenameRole(chatId, roleId, name) {
    name = name.trim();
    if (!name) return;
    await meoTry(() => meoPatchRole(chatId, roleId, {name}), () => meoEditRole(chatId, roleId));
}

async function meoSetRoleColors(chatId, roleId, colors) {
    await meoTry(() => meoPatchRole(chatId, roleId, {colors}), () => meoEditRole(chatId, roleId));
}

function meoSaveRoleColors(chatId, roleId) {
    const c1 = document.getElementById("meo-color-1")?.value.slice(1);
    const c2 = document.getElementById("meo-color-2")?.value.slice(1);
    meoSetRoleColors(chatId, roleId, c2 ? [c1, c2] : [c1]);
}

function meoToggleGradient(chatId, roleId, on) {
    const c1 = document.getElementById("meo-color-1").value.slice(1);
    meoSetRoleColors(chatId, roleId, on ? [c1, c1 === "ff5e5e" ? "765dee" : "ff5e5e"] : [c1]);
}

// --- Bans ------------------------------------------------------------------
function meoRenderBans(chatId) {
    const box = document.getElementById("meo-bans");
    if (!box) return;
    const bans = (chatCache[chatId].bans || []).filter(b => b.expires === null || b.expires * 1000 > Date.now());
    box.innerHTML = bans.map(b => `
        <div class="member-in">
            <span>@${meoEsc(b.username)} <span class="subsubheader">${b.expires ? `until ${new Date(b.expires * 1000).toLocaleString()}` : "permanent"}</span></span>
            <button class="settings-button-in" onclick="meoUnban('${chatId}', '${meoEsc(b.username)}')">Unban</button>
        </div>`).join("") || `<span class="subsubheader">No one is banned.</span>`;
}

async function meoUnban(chatId, username) {
    await meoTry(() => meoApi(`/chats/${chatId}/bans/${username}`, "DELETE"), () => {
        chatCache[chatId].bans = (chatCache[chatId].bans || []).filter(b => b.username !== username);
        meoRenderBans(chatId);
    });
}

// ---------------------------------------------------------------------------
// Members: roles, remove and ban
// ---------------------------------------------------------------------------
chatMembers = async function (chatId) {
    setTop();
    let data;
    try { data = await meoEnsureChat(chatId); } catch (e) { openUpdate(`Unable to open chat: ${meoEsc(e.message)}`); return; }
    const me = meoUser();
    const canInvite = meoHas(data, me, "invite_members") && (data.invites_enabled !== false || meoHas(data, me, "toggle_invites"));
    const main = document.getElementById("main");
    main.innerHTML = `
    <div class="settings">
        <h1>${lang().chats.members} <span class="subsubheader">(${data.members.length})</span></h1>
        ${canInvite ? `<button class="member button" onclick="addMembertoGCModal('${chatId}')">Invite member</button>` : ""}
        <div class="member-list">${data.members.map(m => {
            const role = meoTopRole(data, m);
            const colored = meoTopRole(data, m, true);
            return `
            <div class="member-in meo-member" onclick="meoMemberModal('${chatId}', '${m}')">
                <span><span style="${colored ? meoColorStyle(colored.colors) : ""}">@${meoEsc(m)}</span>${m === data.owner ? ` <span class="subsubheader">Owner</span>` : role && role._id !== "default" ? ` <span class="subsubheader">${meoEsc(role.name)}</span>` : ""}</span>
            </div>`;
        }).join("")}</div>
        <hr>
        <div class="settings-buttons-row">
            ${data.owner === me
                ? `<button onclick="transferOwnershipModal('${chatId}')" class="settings-button-in">Transfer Ownership</button>`
                : `<button onclick="closeChatModal(event, '${chatId}', '${escapeHTML(data.nickname)}')" class="settings-button-in red">${lang().chats.leave}</button>`}
        </div>
    </div>`;
};

function meoMemberModal(chatId, username) {
    const chat = chatCache[chatId];
    const me = meoUser();
    const canRemove = username !== me && meoHas(chat, me, "remove_members") && meoOutranks(chat, me, username);
    const canBan = username !== me && meoHas(chat, me, "ban_members") && meoOutranks(chat, me, username);
    const has = id => (chat.member_roles?.[username] || []).includes(id);
    meoModal(`@${meoEsc(username)}`, `
        <h4 class="meo-tier">Roles</h4>
        <div class="meo-role-checks">${meoSortedRoles(chat).map(r => `
            <label class="meo-check"><input type="checkbox" ${has(r._id) ? "checked" : ""} ${meoCanAssign(chat, me, username, r) ? "" : "disabled"}
                onchange="meoAssignRole('${chatId}', '${username}', '${r._id}', this.checked)"> <span style="${meoColorStyle(r.colors)}">${meoEsc(r.name)}</span></label>`).join("")}
        </div>`,
        `<button class="modal-back-btn" onclick="closemodal(); openUsrModal('${username}')">Profile</button>
         ${canRemove ? `<button class="modal-back-btn" onclick="meoRemoveMember('${chatId}', '${username}')">Remove</button>` : ""}
         ${canBan ? `<button class="modal-back-btn" onclick="meoBanModal('${chatId}', '${username}')">Ban</button>` : ""}`);
}

async function meoAssignRole(chatId, username, roleId, on) {
    await meoTry(() => meoApi(`/chats/${chatId}/members/${username}/roles/${roleId}`, on ? "PUT" : "DELETE"), () => {
        const chat = chatCache[chatId];
        chat.member_roles = chat.member_roles || {};
        const list = chat.member_roles[username] || [];
        chat.member_roles[username] = on ? [...list.filter(x => x !== roleId), roleId] : list.filter(x => x !== roleId);
    });
    meoMemberModal(chatId, username);
}

async function meoRemoveMember(chatId, username) {
    await meoTry(() => meoApi(`/chats/${chatId}/members/${username}`, "DELETE"), () => {
        const chat = chatCache[chatId];
        chat.members = chat.members.filter(m => m !== username);
        closemodal();
        chatMembers(chatId);
    });
}

function meoBanModal(chatId, username) {
    meoModal(`Ban @${meoEsc(username)}?`, `
        <span>They'll be removed and can't rejoin until the ban ends.</span>
        <select id="meo-ban-length" class="mdl-inp">
            <option value="3600">1 hour</option>
            <option value="86400">1 day</option>
            <option value="604800">1 week</option>
            <option value="">Permanent</option>
        </select>`,
        `<button class="modal-back-btn" onclick="closemodal()">Cancel</button>
         <button class="modal-back-btn" onclick="meoBan('${chatId}', '${username}')">Ban</button>`);
}

async function meoBan(chatId, username) {
    const len = document.getElementById("meo-ban-length").value;
    await meoTry(() => meoApi(`/chats/${chatId}/bans/${username}`, "PUT", len ? {expires_in: Number(len)} : {}), () => {
        const chat = chatCache[chatId];
        chat.members = chat.members.filter(m => m !== username);
        closemodal();
        chatMembers(chatId);
    });
}

// ---------------------------------------------------------------------------
// Creating chats: purpose presets
// ---------------------------------------------------------------------------
const MEO_PURPOSES = [
    ["friends", "Friends & Family", "For close friends and family. Everyone can send messages, invite people, customise the chat, add emojis and stickers, and pin messages."],
    ["private", "Private Discussion", "For you and people you trust. Only you and roles you give permission can invite people."],
    ["announcements", "Announcements", "Share news & updates with others. Others can't send messages by default."],
    ["emojis", "Emojis & Stickers", "Just for sharing emojis and stickers. Others can't send messages by default."],
    ["other", "Other", "Everyone can send messages, delete their own messages and invite people. Perfect for most chats!"],
];
let meoPurpose = "other";

createChatModal = function () {
    meoPurpose = "other";
    meoModal(lang().action.creategc, `
        <input id="chat-nick-input" class="mdl-inp" placeholder="${lang().action.nick}" minlength="1" maxlength="32">
        <h4 class="meo-tier">Purpose</h4>
        <div class="meo-purposes">${MEO_PURPOSES.map(([k, l]) => `<button class="meo-purpose${k === meoPurpose ? " selected" : ""}" data-purpose="${k}" onclick="meoPickPurpose('${k}')">${l}</button>`).join("")}</div>
        <p class="meo-purpose-info" id="meo-purpose-info">${MEO_PURPOSES.find(p => p[0] === meoPurpose)[2]}</p>
        <span class="subsubheader">You can always change these settings later.</span>`,
        `<button class="modal-back-btn" onclick="createChat()">${lang().action.create}</button>`);
};

function meoPickPurpose(key) {
    meoPurpose = key;
    document.querySelectorAll(".meo-purpose").forEach(b => b.classList.toggle("selected", b.dataset.purpose === key));
    document.getElementById("meo-purpose-info").textContent = MEO_PURPOSES.find(p => p[0] === key)[2];
}

createChat = async function () {
    const nickname = document.getElementById("chat-nick-input").value.trim();
    if (!nickname) { openUpdate("Chat nickname too short!"); return; }
    await meoTry(() => meoApi("/chats", "POST", {nickname, purpose: meoPurpose}), data => {
        chatCache[data._id] = data;
        closemodal();
        renderChats();
        loadchat(data._id);
    });
};

// ---------------------------------------------------------------------------
// Account: data export and reports
// ---------------------------------------------------------------------------
const meoOrigLoadAccount = loadAccount;
loadAccount = function () {
    const r = meoOrigLoadAccount();
    const settings = document.querySelector(".settings");
    if (settings && !settings.querySelector("#meo-account-extra")) {
        settings.insertAdjacentHTML("beforeend", `
        <div id="meo-account-extra">
            <h3>Your Data</h3>
            <div class="meo-export"><span id="meo-export-status">Checking...</span> <button class="settings-button-in" id="meo-export-btn" disabled>Request</button></div>
            <h3>My Reports</h3>
            <button class="settings-button-in" onclick="meoShowReports()">View my reports</button>
        </div>`);
        meoLoadExport();
    }
    return r;
};

const meoSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
let meoExportTimer = null;

async function meoLoadExport() {
    const status = document.getElementById("meo-export-status");
    const btn = document.getElementById("meo-export-btn");
    if (!status) return;
    clearTimeout(meoExportTimer);
    let exp = null;
    try { exp = await meoApi("/me/export"); } catch (e) {}
    btn.disabled = false;
    if (exp && exp.status === "pending") {
        status.textContent = "Preparing your export...";
        btn.disabled = true;
        btn.textContent = "Request";
        meoExportTimer = setTimeout(meoLoadExport, 3000);
    } else if (exp && exp.status === "completed") {
        status.textContent = `Your export is ready${exp.size ? ` · ${meoSize(exp.size)}` : ""}${exp.expires_at ? ` · expires ${new Date(exp.expires_at * 1000).toLocaleDateString()}` : ""}`;
        btn.textContent = "Download";
        btn.onclick = meoDownloadExport;
    } else {
        status.textContent = exp && exp.status === "failed" ? "Your last export failed." : "Download a copy of your account data.";
        btn.textContent = "Request";
        btn.onclick = async () => {
            btn.disabled = true;
            await meoTry(() => meoApi("/me/export", "POST"));
            meoLoadExport();
        };
    }
}

async function meoDownloadExport() {
    await meoTry(async () => {
        const resp = await fetch(API_URL + "/me/export/download", {headers: {token: localStorage.getItem("token")}});
        if (!resp.ok) throw new Error(`Error ${resp.status}`);
        const url = URL.createObjectURL(await resp.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `meower-data-${meoUser()}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
}

async function meoShowReports() {
    meoModal("My Reports", `<div class="meo-list"><span>Loading...</span></div>`);
    const status = {pending: "Under review", no_action_taken: "No action taken", action_taken: "Action taken"};
    try {
        const data = await meoApi("/me/reports");
        const list = document.querySelector("#mdl-meo2 .meo-list");
        const reports = data.autoget || [];
        list.innerHTML = reports.length ? reports.map(r => `
            <div class="meo-pin">
                <b>${r.type === "user" ? `@${meoEsc(r.content_id)}` : r.content && r.content.u ? `Post by @${meoEsc(r.content.u)}` : "Deleted post"}</b>
                <span class="subsubheader">${status[r.status] || meoEsc(r.status)}</span>
                <div>${meoEsc(r.reason)}${r.comment ? ` · ${meoEsc(r.comment)}` : ""}</div>
            </div>`).join("") : "<span>You haven't reported anything.</span>";
    } catch (e) {
        openUpdate(meoEsc(e.message));
    }
}
