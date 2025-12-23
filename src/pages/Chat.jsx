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
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const fileInputRef = useRef(null);

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

  useEffect(() => {
    scrollToBottom();
    if (!messages.length || !chat) return;

    messages.forEach((msg) => {
      if (msg.sender._id !== user.id && !msg.seenBy?.includes(user.id)) {
        socketRef.current.emit("message seen", {
          messageId: msg._id,
          userId: user.id,
          senderId: msg.sender._id, // Added senderId for 1-to-1 messaging
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

    socketRef.current.emit("setup", data.user._id || data.user.id);
    fetchUsers(data.token);

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
    const usersData = await res.json();
    setUsers(usersData);
    
    // Set online users based on isOnline field from database
    const onlineUserIds = usersData
      .filter(u => u.isOnline)
      .map(u => u._id);
    setOnlineUsers(onlineUserIds);
    console.log("📡 Online users from database:", onlineUserIds);
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

    if (!socketRef.current || !chat || !selectedUser) return;

    if (!typing) {
      setTyping(true);
      console.log("Emitting typing event for chat:", chat._id, "to user:", selectedUser._id);
      socketRef.current.emit("typing", { 
        chatId: chat._id, 
        toUserId: selectedUser._id 
      });
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout
    typingTimeoutRef.current = setTimeout(() => {
      console.log("Emitting stop typing event for chat:", chat._id, "to user:", selectedUser._id);
      socketRef.current.emit("stop typing", { 
        chatId: chat._id, 
        toUserId: selectedUser._id 
      });
      setTyping(false);
    }, 3000);
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    // Clear typing timeout and stop typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (selectedUser) {
      socketRef.current.emit("stop typing", { 
        chatId: chat._id, 
        toUserId: selectedUser._id 
      });
    }
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

  const uploadProfilePic = async (file) => {
    if (!file) return;
    
    console.log("Uploading file:", file.name, file.type, file.size);
    setUploadingProfile(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const token = JSON.parse(localStorage.getItem("userInfo")).token;
      console.log("Making request to upload endpoint...");
      
      const res = await fetch("http://localhost:5000/api/users/upload-profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      console.log("Response status:", res.status);
      
      // Try to get response as text first to see the actual error
      const responseText = await res.text();
      console.log("Raw response:", responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error("Response is not JSON:", responseText);
        throw new Error("Server returned non-JSON response");
      }
      
      if (res.ok) {
        // Update user data
        setUser(prev => ({ ...prev, profilePic: data.profilePic }));
        // Refresh users list to show updated profile
        const userData = JSON.parse(localStorage.getItem("userInfo"));
        fetchUsers(userData.token);
        console.log("Profile updated successfully!");
      } else {
        console.error("Upload failed:", data);
        alert("Upload failed: " + (data.message || "Unknown error"));
      }
    } catch (error) {
      console.error("Profile upload error:", error);
      alert("Upload error: " + error.message);
    } finally {
      setUploadingProfile(false);
    }
  };

  const handleProfileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      uploadProfilePic(file);
    }
  };

  const handleFileSend = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile || !chat) return;

    // Check file type and size
    const allowedTypes = [
      'image/jpeg', 
      'image/jpg', 
      'image/png', 
      'image/gif', 
      'image/webp', 
      'application/pdf', 
      'text/plain',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
    ];
    const maxSize = 10 * 1024 * 1024; // 10MB

    console.log("Selected file type:", selectedFile.type);
    console.log("Selected file size:", selectedFile.size);

    if (!allowedTypes.includes(selectedFile.type)) {
      alert(`File type "${selectedFile.type}" not allowed. Please upload JPG, PNG, GIF, WebP, PDF, DOC, DOCX, or TXT files only.`);
      e.target.value = '';
      return;
    }

    if (selectedFile.size > maxSize) {
      alert('File size too large. Please upload files smaller than 10MB.');
      e.target.value = '';
      return;
    }

    const fileFormData = new FormData();
    fileFormData.append('file', selectedFile);
    fileFormData.append('chatId', chat._id);

    try {
      const userToken = JSON.parse(localStorage.getItem("userInfo")).token;
      const fileResponse = await fetch("http://localhost:5000/api/message", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
        body: fileFormData,
      });

      const fileMessageData = await fileResponse.json();
      if (fileResponse.ok) {
        setMessages((prev) => [...prev, fileMessageData]);
        socketRef.current.emit("new message", fileMessageData);
      } else {
        alert('Upload failed: ' + (fileMessageData.message || 'Unknown error'));
      }
    } catch (fileError) {
      console.error("File send error:", fileError);
      alert('Upload failed: ' + fileError.message);
    }

    // Reset file input
    e.target.value = '';
  };

  return (
    <div className="h-screen flex bg-[#0f172a] text-white">
      {/* LEFT USERS PANEL */}
      <div className="w-[30%] bg-[#020617] border-r border-gray-700 flex flex-col">
        <div className="p-4 text-lg font-semibold border-b border-gray-700 flex justify-between items-center">
          <span>Chats</span>
          
          {/* Profile Upload Button */}
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              onChange={handleProfileUpload}
              className="hidden"
              id="profile-upload"
            />
            <label
              htmlFor="profile-upload"
              className={`cursor-pointer p-2 rounded-full hover:bg-gray-700 transition ${
                uploadingProfile ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              title="Upload Profile Picture"
            >
              {uploadingProfile ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-white rounded-full animate-spin"></div>
              ) : (
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {users.map((u) => (
            <div
              key={u._id}
              onClick={() => accessChat(u._id)}
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#020617]/80 border-b border-gray-800"
            >
              <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center font-bold overflow-hidden">
                {u.profilePic ? (
                  <img 
                    src={`http://localhost:5000${u.profilePic}`} 
                    alt={u.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <span className={u.profilePic ? "hidden" : "block"}>
                  {u.name[0].toUpperCase()}
                </span>
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
              <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold overflow-hidden">
                {selectedUser.profilePic ? (
                  <img 
                    src={`http://localhost:5000${selectedUser.profilePic}`} 
                    alt={selectedUser.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <span className={selectedUser.profilePic ? "hidden" : "block"}>
                  {selectedUser.name[0].toUpperCase()}
                </span>
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
                className={`flex ${isMe ? "justify-end" : "justify-start"} mb-2`}
              >
                {m.fileType === "image" ? (
                  // Image message - no background bubble
                  <div className={`relative ${isMe ? "ml-12" : "mr-12"}`}>
                    <img
                      src={`http://localhost:5000${m.file}`}
                      alt="Shared image"
                      className="max-w-xs rounded-lg shadow-lg"
                    />
                    {isMe && (
                      <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 rounded px-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={isMessageSeen(m) ? "#3b82f6" : "#ffffff"}
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
                ) : (
                  // Text/File message - with background bubble
                  <div
                    className={`relative px-4 py-3 max-w-[70%] rounded-xl text-sm shadow-lg
                    ${
                      isMe
                        ? "bg-indigo-600 text-white rounded-br-none"
                        : "bg-gray-800 text-white rounded-bl-none"
                    }`}
                  >
                    {!isMe && (
                      <p className="text-xs text-indigo-300 mb-1">
                        {m.sender.name}
                      </p>
                    )}

                    {m.file ? (
                      <a
                        href={`http://localhost:5000${m.file}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 underline flex items-center gap-2"
                      >
                        📄 Download File
                      </a>
                    ) : (
                      m.content
                    )}

                    {isMe && (
                      <div className="flex justify-end mt-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={isMessageSeen(m) ? "#3b82f6" : "#9ca3af"}
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
                )}
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
          <div className="p-4 bg-[#020617] border-t border-gray-700">
            {/* Hidden file input */}
            <input
              type="file"
              hidden
              ref={fileInputRef}
              onChange={handleFileSend}
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.txt"
            />
            
            <div className="flex gap-3 items-center bg-gray-800 rounded-full px-4 py-2">
              {/* Plus icon for attachment */}
              <button
                onClick={() => fileInputRef.current.click()}
                className="text-gray-400 hover:text-white transition p-1"
                title="Attach file"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
                </svg>
              </button>

              <input
                value={newMessage}
                onChange={typingHandler}
                onKeyDown={handleKeyDown}
                placeholder="Write a message..."
                className="flex-1 bg-transparent outline-none text-white placeholder-gray-400"
              />

              <button
                onClick={sendMessage}
                className="text-indigo-400 hover:text-indigo-300 transition p-1"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                >
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
