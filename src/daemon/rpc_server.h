#pragma once

#include "daemon/kvm_doctor.h"
#include "daemon/remote_session.h"
#include "daemon/remote_webrtc.h"
#include "daemon/runtime_manager.h"
#include "daemon/vm_store.h"
#include "ipc/unix_socket.h"

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>

namespace tenbox::daemon {

class RpcServer {
public:
    RpcServer(DaemonConfig config, VmStore& store, RuntimeManager& runtime_manager);
    ~RpcServer();

    bool Start(std::string* error);
    void Run();
    void Stop();

private:
    void HandleClient(ipc::UnixSocketConnection client);
    nlohmann::json HandleRequest(const nlohmann::json& request);
    void ApplySocketPermissions();
    nlohmann::json CreateVm(const nlohmann::json& request);
    nlohmann::json EditVm(const nlohmann::json& request);
    nlohmann::json VmResources(const VmRecord& record) const;

    nlohmann::json HandleRemoteSignal(const nlohmann::json& request);
    std::shared_ptr<WebRtcPeer> CreateRemotePeer(const std::string& session_id, const std::string& vm_id);
    void HandleDataChannelMessage(const std::string& vm_id, const nlohmann::json& message);
    void CleanupRemotePeer(const std::string& session_id, const std::string& vm_id);

    DaemonConfig config_;
    VmStore& store_;
    RuntimeManager& runtime_manager_;
    RemoteSessionRegistry remote_sessions_;
    ipc::UnixSocketServer server_;
    std::atomic<bool> running_{false};

    std::mutex remote_peers_mu_;
    std::unordered_map<std::string, std::shared_ptr<WebRtcPeer>> remote_peers_;
};

}  // namespace tenbox::daemon
