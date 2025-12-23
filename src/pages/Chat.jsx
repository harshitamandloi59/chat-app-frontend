import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";

const ENDPOINT = "http://localhost:5000";

const Chat = () => {
  const socketRef = useRef();
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [chat, setChat] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [typing, setTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
const isMessageSeen = (message) => {
  if (!message?.seenBy || !user) return false;

  // Check if anyone OTHER than the sender has seen the message
  return message.seenBy.some(
    (u) => {
      const userId = typeof u === "string" ? u : u._id;
      const currentUserId = user._id || user.id;
      return userId !== currentUserId; // Someone else has seen it
    }
  );
};
const getChatUser = () => {
  if (!chat || !user) return null;
  return chat.users.find((u) => u._id !== user.id);
};

  useEffect(() => {
    scrollToBottom();
    if (!messages.length || !chat) return;

    messages.forEach((msg) => {
      if (msg.sender._id !== user.id && !msg.seenBy?.includes(user.id)) {
        socketRef.current.emit("message seen", {
          messageId: msg._id,
          userId: user.id,
        });
      }
    });
  }, [messages]);

  useEffect(() => {
    const data = JSON.parse(localStorage.getItem("userInfo"));
    setUser(data.user);

    console.log("Connecting to socket server...");
    socketRef.current = io(ENDPOINT, {
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      console.log("Connected to socket server");
    });

    socketRef.current.on("disconnect", () => {
      console.log("Disconnected from socket server");
    });

    socketRef.current.on("connect_error", (error) => {
      console.log("Socket connection error:", error);
    });

    socketRef.current.emit("setup", data.user.id);
    fetchUsers(data.token);

    // Listen for online users updates
    socketRef.current.on("online users", (users) => {
      console.log("Online users:", users);
      // Handle both array of IDs and array of user objects
      const userIds = users.map(u => typeof u === 'string' ? u : u._id || u.id);
      setOnlineUsers(userIds);
    });

    socketRef.current.on("user online", (userId) => {
      console.log("User came online:", userId);
      const id = typeof userId === 'string' ? userId : userId._id || userId.id;
      setOnlineUsers(prev => [...new Set([...prev, id])]);
    });

    socketRef.current.on("user offline", (userId) => {
      console.log("User went offline:", userId);
      const id = typeof userId === 'string' ? userId : userId._id || userId.id;
      setOnlineUsers(prev => prev.filter(uid => uid !== id));
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socketRef.current) return;

    socketRef.current.on("message seen update", ({ messageId, userId }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId
            ? { ...msg, seenBy: [...(msg.seenBy || []), userId] }
            : msg
        )
      );
    });

    return () => {
      socketRef.current.off("message seen update");
    };
  }, []);

  useEffect(() => {
    if (!socketRef.current) return;

    const handleMessageReceived = (msg) => {
      if (!chat || msg.chat._id !== chat._id) return;
      setMessages((prev) => [...prev, msg]);
    };

    const handleTyping = () => {
      console.log("Received typing event");
      setIsTyping(true);
    };
    const handleStopTyping = () => {
      console.log("Received stop typing event");
      setIsTyping(false);
    };

    socketRef.current.on("message received", handleMessageReceived);
    socketRef.current.on("typing", handleTyping);
    socketRef.current.on("stop typing", handleStopTyping);

    return () => {
      socketRef.current.off("message received", handleMessageReceived);
      socketRef.current.off("typing", handleTyping);
      socketRef.current.off("stop typing", handleStopTyping);
    };
  }, [chat]);

  const fetchUsers = async (token) => {
    const res = await fetch("http://localhost:5000/api/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    setUsers(await res.json());
  };

  const accessChat = async (userId) => {
    const token = JSON.parse(localStorage.getItem("userInfo")).token;

    // Find and store the selected user
    const clickedUser = users.find(u => u._id === userId);
    setSelectedUser(clickedUser);

    const res = await fetch("http://localhost:5000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId }),
    });

    const data = await res.json();
    setChat(data);

    fetchMessages(data._id);
    socketRef.current.emit("join chat", data._id);
  };

  const fetchMessages = async (chatId) => {
    const token = JSON.parse(localStorage.getItem("userInfo")).token;

    const res = await fetch(`http://localhost:5000/api/message/${chatId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setMessages(await res.json());
  };

  const typingHandler = (e) => {
    setNewMessage(e.target.value);

    if (!socketRef.current || !chat) return;

    if (!typing) {
      setTyping(true);
      console.log("Emitting typing event for chat:", chat._id);
      socketRef.current.emit("typing", chat._id);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout
    typingTimeoutRef.current = setTimeout(() => {
      console.log("Emitting stop typing event for chat:", chat._id);
      socketRef.current.emit("stop typing", chat._id);
      setTyping(false);
    }, 3000);
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    // Clear typing timeout and stop typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socketRef.current.emit("stop typing", chat._id);
    setTyping(false);

    const token = JSON.parse(localStorage.getItem("userInfo")).token;

    try {
      const res = await fetch("http://localhost:5000/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: newMessage,
          chatId: chat._id,
        }),
      });

      const data = await res.json();
      setMessages((prev) => [...prev, data]);
      socketRef.current.emit("new message", data);
      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  return (
    <div className="h-screen flex bg-[#0f172a] text-white">
      {/* LEFT USERS PANEL */}
      <div className="w-[30%] bg-[#020617] border-r border-gray-700 flex flex-col">
        <div className="p-4 text-lg font-semibold border-b border-gray-700">
          Chats
        </div>

        <div className="flex-1 overflow-y-auto">
          {users.map((u) => (
            <div
              key={u._id}
              onClick={() => accessChat(u._id)}
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#020617]/80 border-b border-gray-800"
            >
              <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center font-bold">
                {u.name[0].toUpperCase()}
              </div>

              <div className="flex-1">
                <p className="font-medium">{u.name}</p>
                <p
                  className={`text-xs ${
                    onlineUsers.includes(u._id) ? "text-green-400" : "text-gray-500"
                  }`}
                >
                  {onlineUsers.includes(u._id) ? "Online" : "Offline"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT CHAT PANEL */}
      <div className="flex-1 flex flex-col bg-[#020617]">
        {/* CHAT HEADER */}
        <div className="h-16 px-6 flex items-center gap-4 border-b border-gray-700 bg-[#020617]">
          {selectedUser ? (
            <>
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold">
                {selectedUser.name[0].toUpperCase()}
              </div>

              {/* Name + Status */}
              <div className="flex flex-col">
                <p className="font-semibold text-white">
                  {selectedUser.name}
                </p>
                <p
                  className={`text-xs ${
                    onlineUsers.includes(selectedUser._id)
                      ? "text-green-400"
                      : "text-gray-400"
                  }`}
                >
                  {onlineUsers.includes(selectedUser._id) ? "Online" : "Offline"}
                </p>
              </div>
            </>
          ) : (
            <p className="text-gray-400">Select a user to start chat</p>
          )}
        </div>

        {/* MESSAGES */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#0f172a]">
          {messages.map((m, i) => {
            const isMe = m.sender._id === user._id || m.sender._id === user.id;

            return (
              <div
                key={i}
                className={`flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`relative px-4 py-3 max-w-[70%] rounded-xl text-sm shadow-lg
                  ${
                    isMe
                      ? "bg-indigo-600 rounded-br-none"
                      : "bg-gray-800 rounded-bl-none"
                  }`}
                >
                  {!isMe && (
                    <p className="text-xs text-indigo-300 mb-1">
                      {m.sender.name}
                    </p>
                  )}

                  {m.content}

                  {isMe && (
                    <div className="flex justify-end mt-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={isMessageSeen(m) ? "#3b82f6" : "#9ca3af"}
                        // blue / gray
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="1 12 5 16 10 7" />
                        <polyline points="12 12 16 16 23 7" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* TYPING */}
        {isTyping && (
          <div className="px-6 py-2 text-sm italic text-gray-400 bg-[#020617]">
            Typing...
          </div>
        )}

        {/* INPUT BOX */}
        {chat && (
          <div className="p-4 bg-[#020617] border-t border-gray-700 flex gap-3">
            <input
              value={newMessage}
              onChange={typingHandler}
              onKeyDown={handleKeyDown}
              placeholder="Write a message..."
              className="flex-1 bg-gray-800 px-5 py-3 rounded-full outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <button
              onClick={sendMessage}
              className="ml-2 w-10 h-10 flex items-center justify-center rounded-full bg-blue-500 hover:bg-blue-600"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="white"
                viewBox="0 0 24 24"
                width="20"
                height="20"
              >
                <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
