import { useEffect, useState, useRef } from "react";
import { MeshNetwork } from "./services/meshNetwork";
import {
  LoginScreen,
  Sidebar,
  ChatArea,
  Modal,
} from "./components/uiComponents";
import "./styles.css";

const SERVER_URL = "http://localhost:3001";

export default function App() {
  const [userId, setUserId] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [activeChat, setActiveChat] = useState("");
  const [logs, setLogs] = useState([]);
  const [peerStatus, setPeerStatus] = useState({});
  const [groups, setGroups] = useState({});

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    type: "",
    title: "",
    content: null,
  });
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");

  const meshRef = useRef(null);

  // Handler Network Events
  const handleNetworkEvent = (event, data) => {
    switch (event) {
      case "status_update":
        setPeerStatus((prev) => ({ ...prev, [data.target]: data.status }));
        break;
      case "message_received":
        setLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            from: data.from,
            text: data.text,
            to: data.groupId || null,
            isGroup: !!data.groupId,
            isMe: false,
            proof: data.proof,
            showProof: false,
          },
        ]);
        break;
      case "contact_connected":
        // Kirim ID remoteUser (string)
        setContacts((prev) => (prev.includes(data) ? prev : [...prev, data]));
        break;
      case "group_invite":
        setGroups((prev) => ({ ...prev, [data.groupId]: data.members }));
        setContacts((prev) =>
          prev.includes(data.groupId) ? prev : [...prev, data.groupId]
        );
        break;
      case "error":
        openAlert("Network Error", data.message);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    meshRef.current = new MeshNetwork(SERVER_URL, handleNetworkEvent);
    return () => meshRef.current.disconnect();
  }, []);

  const handleLogin = async (uid) => {
    if (!uid.trim()) return;
    const cleanId = uid.trim().toLowerCase();
    await meshRef.current.register(cleanId);
    setUserId(cleanId);
  };

  const handleAddContact = (id) => {
    const clean = id.trim().toLowerCase();
    if (clean && !contacts.includes(clean) && clean !== userId) {
      setContacts((prev) => [...prev, clean]);
      meshRef.current.connectTo(clean);
    }
  };

  const handleSend = async (content) => {
    const isGroup = !!groups[activeChat];
    const members = groups[activeChat] || [];

    const proof = await meshRef.current.sendMessage(
      activeChat,
      content,
      isGroup,
      members
    );

    setLogs((prev) => [
      ...prev,
      {
        id: Date.now(),
        from: "Me",
        to: activeChat,
        text: content,
        isGroup: isGroup,
        isMe: true,
        proof: proof, 
        showProof: false,
      },
    ]);
  };

  const toggleProof = (id) => {
    setLogs((prev) =>
      prev.map((m) => (m.id === id ? { ...m, showProof: !m.showProof } : m))
    );
  };

  const openAlert = (title, msg) => {
    setModalConfig({
      isOpen: true,
      type: "alert",
      title,
      content: <p>{msg}</p>,
    });
  };

  const openGroupModal = () => {
    setModalConfig({
      isOpen: true,
      type: "group_form",
      title: "Create New Mesh Group",
    });
  };

  const confirmCreateGroup = () => {
    if (groupNameInput && groupMembersInput) {
      const members = groupMembersInput
        .split(",")
        .map((s) => s.trim().toLowerCase());
      if (!members.includes(userId)) members.push(userId);

      setGroups((p) => ({ ...p, [groupNameInput]: members }));
      setContacts((p) => [...p, groupNameInput]);

      members.forEach((m) => {
        if (m !== userId) {
          meshRef.current.connectTo(m);
          meshRef.current.socket.emit("signal", {
            target: m,
            sender: userId,
            payload: { type: "group_invite", groupId: groupNameInput, members },
          });
        }
      });

      closeModal();
      openAlert("Success", `Group '${groupNameInput}' created.`);
    } else {
      openAlert("Error", "Please fill all fields.");
    }
  };

  const closeModal = () => {
    setModalConfig({ isOpen: false });
    setGroupNameInput("");
    setGroupMembersInput("");
  };

  // Filter Messages
  const activeMessages = logs.filter((l) => {
    const isGroupChat = !!groups[activeChat];
    if (isGroupChat) return l.to === activeChat;
    return (
      (l.from === activeChat && !l.isGroup) ||
      (l.from === "Me" && l.to === activeChat)
    );
  });

  if (!userId) return <LoginScreen onJoin={handleLogin} />;

  return (
    <div style={{ display: "flex", overflow: "hidden" }}>
      <Modal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        onClose={closeModal}
        onConfirm={
          modalConfig.type === "group_form" ? confirmCreateGroup : closeModal
        }
        confirmText={modalConfig.type === "group_form" ? "Create Group" : "OK"}
      >
        {modalConfig.type === "alert" && modalConfig.content}
        {modalConfig.type === "group_form" && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "6px",
                  fontSize: "12px",
                }}
              >
                Group Name (ID)
              </label>
              <input
                className="input-glass"
                value={groupNameInput}
                onChange={(e) => setGroupNameInput(e.target.value)}
                placeholder="e.g. elite global"
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "6px",
                  fontSize: "12px",
                }}
              >
                Members (Pisahkan dengan koma)
              </label>
              <input
                className="input-glass"
                value={groupMembersInput}
                onChange={(e) => setGroupMembersInput(e.target.value)}
                placeholder="e.g. owi, owo"
              />
            </div>
          </div>
        )}
      </Modal>

      <Sidebar
        userId={userId}
        contacts={contacts}
        peersStatus={peerStatus}
        activeChat={activeChat}
        groupMembers={groups}
        onSelect={setActiveChat}
        onAddContact={handleAddContact}
        onCreateGroup={openGroupModal}
      />
      <ChatArea
        activeChat={activeChat}
        messages={activeMessages}
        isGroup={!!groups[activeChat]}
        onSend={handleSend}
        onLogout={() => window.location.reload()}
        toggleProof={toggleProof}
      />
    </div>
  );
}
