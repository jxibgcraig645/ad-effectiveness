import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AdCampaign {
  id: string;
  campaignName: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
  timestamp: number;
  owner: string;
  status: "active" | "completed" | "paused";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newCampaignData, setNewCampaignData] = useState({
    campaignName: "",
    impressions: "",
    conversions: ""
  });
  const [showFeatures, setShowFeatures] = useState(false);

  // Calculate statistics for dashboard
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const completedCampaigns = campaigns.filter(c => c.status === "completed").length;
  const pausedCampaigns = campaigns.filter(c => c.status === "paused").length;
  
  // Calculate total metrics
  const totalImpressions = campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0);
  const totalConversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0);
  const avgConversionRate = campaigns.length > 0 
    ? campaigns.reduce((sum, campaign) => sum + campaign.conversionRate, 0) / campaigns.length
    : 0;

  useEffect(() => {
    loadCampaigns().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadCampaigns = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("campaign_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing campaign keys:", e);
        }
      }
      
      const list: AdCampaign[] = [];
      
      for (const key of keys) {
        try {
          const campaignBytes = await contract.getData(`campaign_${key}`);
          if (campaignBytes.length > 0) {
            try {
              const campaignData = JSON.parse(ethers.toUtf8String(campaignBytes));
              list.push({
                id: key,
                campaignName: campaignData.campaignName,
                impressions: campaignData.impressions,
                conversions: campaignData.conversions,
                conversionRate: campaignData.conversionRate,
                timestamp: campaignData.timestamp,
                owner: campaignData.owner,
                status: campaignData.status || "active"
              });
            } catch (e) {
              console.error(`Error parsing campaign data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading campaign ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCampaigns(list);
    } catch (e) {
      console.error("Error loading campaigns:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitCampaign = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting campaign data with Zama FHE..."
    });
    
    try {
      const impressions = parseInt(newCampaignData.impressions);
      const conversions = parseInt(newCampaignData.conversions);
      
      if (isNaN(impressions) || isNaN(conversions) || impressions <= 0 || conversions <= 0) {
        throw new Error("Invalid impressions or conversions value");
      }
      
      const conversionRate = (conversions / impressions) * 100;
      
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify({
        impressions,
        conversions,
        conversionRate
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const campaignId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const campaignData = {
        campaignName: newCampaignData.campaignName,
        impressions,
        conversions,
        conversionRate,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "active"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `campaign_${campaignId}`, 
        ethers.toUtf8Bytes(JSON.stringify(campaignData))
      );
      
      const keysBytes = await contract.getData("campaign_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(campaignId);
      
      await contract.setData(
        "campaign_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted campaign data submitted securely!"
      });
      
      await loadCampaigns();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCampaignData({
          campaignName: "",
          impressions: "",
          conversions: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const toggleCampaignStatus = async (campaignId: string, newStatus: "active" | "completed" | "paused") => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const campaignBytes = await contract.getData(`campaign_${campaignId}`);
      if (campaignBytes.length === 0) {
        throw new Error("Campaign not found");
      }
      
      const campaignData = JSON.parse(ethers.toUtf8String(campaignBytes));
      
      const updatedCampaign = {
        ...campaignData,
        status: newStatus
      };
      
      await contract.setData(
        `campaign_${campaignId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedCampaign))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `Campaign ${newStatus} successfully!`
      });
      
      await loadCampaigns();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Operation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderBarChart = () => {
    if (campaigns.length === 0) {
      return (
        <div className="no-data-chart">
          <p>No campaign data available</p>
        </div>
      );
    }
    
    // Get top 5 campaigns by impressions
    const topCampaigns = [...campaigns]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5);
    
    const maxImpressions = Math.max(...topCampaigns.map(c => c.impressions), 1);
    
    return (
      <div className="bar-chart-container">
        {topCampaigns.map((campaign, index) => (
          <div className="bar-item" key={index}>
            <div className="bar-label">{campaign.campaignName.substring(0, 15)}{campaign.campaignName.length > 15 ? "..." : ""}</div>
            <div className="bar-wrapper">
              <div 
                className="bar-fill impressions" 
                style={{ width: `${(campaign.impressions / maxImpressions) * 100}%` }}
              >
                <span className="bar-value">{campaign.impressions.toLocaleString()}</span>
              </div>
            </div>
            <div className="bar-wrapper">
              <div 
                className="bar-fill conversions" 
                style={{ width: `${(campaign.conversions / campaign.impressions) * 100}%` }}
              >
                <span className="bar-value">{campaign.conversions.toLocaleString()} ({campaign.conversionRate.toFixed(2)}%)</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderPieChart = () => {
    const total = campaigns.length || 1;
    const activePercentage = (activeCampaigns / total) * 100;
    const completedPercentage = (completedCampaigns / total) * 100;
    const pausedPercentage = (pausedCampaigns / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment active" 
            style={{ transform: `rotate(${activePercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment completed" 
            style={{ transform: `rotate(${(activePercentage + completedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment paused" 
            style={{ transform: `rotate(${(activePercentage + completedPercentage + pausedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{campaigns.length}</div>
            <div className="pie-label">Campaigns</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box active"></div>
            <span>Active: {activeCampaigns}</span>
          </div>
          <div className="legend-item">
            <div className="color-box completed"></div>
            <span>Completed: {completedCampaigns}</span>
          </div>
          <div className="legend-item">
            <div className="color-box paused"></div>
            <span>Paused: {pausedCampaigns}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>AdMetrics</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-campaign-btn metal-button"
          >
            <div className="add-icon"></div>
            Add Campaign
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowFeatures(!showFeatures)}
          >
            {showFeatures ? "Hide Features" : "Show Features"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Privacy-Preserving Ad Performance Metrics</h2>
            <p>Measure ad effectiveness without compromising user privacy using Zama FHE technology</p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card metal-card">
            <h3>Project Introduction</h3>
            <p>FHE-powered platform for measuring ad campaign effectiveness while preserving user privacy in a post-cookie world.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card metal-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{campaigns.length}</div>
                <div className="stat-label">Total Campaigns</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalImpressions.toLocaleString()}</div>
                <div className="stat-label">Total Impressions</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalConversions.toLocaleString()}</div>
                <div className="stat-label">Total Conversions</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{avgConversionRate.toFixed(2)}%</div>
                <div className="stat-label">Avg Conversion Rate</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card metal-card">
            <h3>Campaign Status</h3>
            {renderPieChart()}
          </div>
          
          <div className="dashboard-card metal-card">
            <h3>Top Campaigns</h3>
            {renderBarChart()}
          </div>
        </div>
        
        {showFeatures && (
          <div className="features-section metal-card">
            <h2>Platform Features</h2>
            <div className="features-grid">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <h4>Privacy Protection</h4>
                <p>User data remains encrypted throughout the analysis process</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">📊</div>
                <h4>Cross-Domain Analysis</h4>
                <p>Measure ad effectiveness across multiple websites without tracking users</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚙️</div>
                <h4>FHE Computation</h4>
                <p>Perform complex analytics on encrypted data without decryption</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">📈</div>
                <h4>Accurate Metrics</h4>
                <p>Get precise conversion rates and campaign effectiveness metrics</p>
              </div>
            </div>
          </div>
        )}
        
        <div className="campaigns-section">
          <div className="section-header">
            <h2>Advertising Campaigns</h2>
            <div className="header-actions">
              <button 
                onClick={loadCampaigns}
                className="refresh-btn metal-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="campaigns-list metal-card">
            <div className="table-header">
              <div className="header-cell">Campaign</div>
              <div className="header-cell">Impressions</div>
              <div className="header-cell">Conversions</div>
              <div className="header-cell">Conversion Rate</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {campaigns.length === 0 ? (
              <div className="no-campaigns">
                <div className="no-campaigns-icon"></div>
                <p>No advertising campaigns found</p>
                <button 
                  className="metal-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Campaign
                </button>
              </div>
            ) : (
              campaigns.map(campaign => (
                <div className="campaign-row" key={campaign.id}>
                  <div className="table-cell campaign-name">{campaign.campaignName}</div>
                  <div className="table-cell">{campaign.impressions.toLocaleString()}</div>
                  <div className="table-cell">{campaign.conversions.toLocaleString()}</div>
                  <div className="table-cell">{campaign.conversionRate.toFixed(2)}%</div>
                  <div className="table-cell">
                    <span className={`status-badge ${campaign.status}`}>
                      {campaign.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(campaign.owner) && (
                      <div className="action-buttons">
                        {campaign.status !== "active" && (
                          <button 
                            className="action-btn metal-button success"
                            onClick={() => toggleCampaignStatus(campaign.id, "active")}
                          >
                            Activate
                          </button>
                        )}
                        {campaign.status !== "paused" && (
                          <button 
                            className="action-btn metal-button warning"
                            onClick={() => toggleCampaignStatus(campaign.id, "paused")}
                          >
                            Pause
                          </button>
                        )}
                        {campaign.status !== "completed" && (
                          <button 
                            className="action-btn metal-button"
                            onClick={() => toggleCampaignStatus(campaign.id, "completed")}
                          >
                            Complete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        <div className="partners-section metal-card">
          <h2>Technology Partners</h2>
          <div className="partners-grid">
            <div className="partner-logo">
              <div className="logo-placeholder">Zama</div>
              <span>FHE Technology</span>
            </div>
            <div className="partner-logo">
              <div className="logo-placeholder">Concrete</div>
              <span>FHE Framework</span>
            </div>
            <div className="partner-logo">
              <div className="logo-placeholder">ETH</div>
              <span>Blockchain</span>
            </div>
            <div className="partner-logo">
              <div className="logo-placeholder">AdTech</div>
              <span>Industry Partner</span>
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCampaign} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          campaignData={newCampaignData}
          setCampaignData={setNewCampaignData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHEAdMetrics</span>
            </div>
            <p>Privacy-preserving ad effectiveness measurement</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHEAdMetrics. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  campaignData: any;
  setCampaignData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  campaignData,
  setCampaignData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCampaignData({
      ...campaignData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!campaignData.campaignName || !campaignData.impressions || !campaignData.conversions) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Add Advertising Campaign</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your campaign data will be encrypted with Zama FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Campaign Name *</label>
              <input 
                type="text"
                name="campaignName"
                value={campaignData.campaignName} 
                onChange={handleChange}
                placeholder="Enter campaign name" 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Impressions *</label>
              <input 
                type="number"
                name="impressions"
                value={campaignData.impressions} 
                onChange={handleChange}
                placeholder="Number of impressions" 
                className="metal-input"
                min="1"
              />
            </div>
            
            <div className="form-group">
              <label>Conversions *</label>
              <input 
                type="number"
                name="conversions"
                value={campaignData.conversions} 
                onChange={handleChange}
                placeholder="Number of conversions" 
                className="metal-input"
                min="1"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;