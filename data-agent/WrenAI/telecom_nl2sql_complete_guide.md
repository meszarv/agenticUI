# 电信网络管理系统 NL2SQL 测试完整方案
# Telecom NMS — Schema + Field Dictionary + QA Test Suite

---

## 一、Schema 总览

**14张表 = 10张OLTP存量表 + 4张OLAP性能表**

| 编号 | 表名 | 中文名 | 类型 | 字段数 | 核心业务角色 |
|------|------|--------|------|--------|-------------|
| 1 | t_site | 站点 | OLTP | 22 | 物理机房/POP点 |
| 2 | t_network_element | 网元 | OLTP | 30 | 路由器/交换机（PE/P/CE/RR） |
| 3 | t_board | 单板 | OLTP | 20 | 设备内线卡/主控板 |
| 4 | t_interface | 接口 | OLTP | 28 | 物理口/逻辑口/Trunk |
| 5 | t_physical_link | 物理链路 | OLTP | 26 | 两接口间的光纤/电缆连接 |
| 6 | t_vrf_instance | VRF实例 | OLTP | 22 | PE上的VPN路由转发表 |
| 7 | t_l3vpn_service | L3VPN业务 | OLTP | 28 | 端到端VPN服务实例 |
| 8 | t_vpn_pe_binding | VPN-PE绑定 | OLTP | 20 | VPN与PE设备的M:N关联 |
| 9 | t_srv6_policy | SRv6 Policy | OLTP | 24 | SRv6 TE隧道策略 |
| 10 | t_tunnel | 隧道 | OLTP | 24 | 逻辑隧道（SRv6/MPLS） |
| 11 | t_ne_perf_kpi | 网元KPI | OLAP | 24 | CPU/内存/温度/路由表 |
| 12 | t_interface_perf_kpi | 接口KPI | OLAP | 26 | 流量/带宽利用率/错包 |
| 13 | t_tunnel_perf_kpi | 隧道KPI | OLAP | 22 | 时延/抖动/丢包(iFIT) |
| 14 | t_vpn_sla_kpi | VPN SLA KPI | OLAP | 22 | 端到端SLA达标情况 |

**核心关系链**：

```
t_site ──1:N──> t_network_element ──1:N──> t_board ──1:N──> t_interface
                      │                                         │
                      ├──1:N──> t_interface                     │
                      │              │                           │
                      │              ├──N:1(A/Z端)──> t_physical_link
                      │              └──1:N──> t_vrf_instance
                      │                              │
                      ├──1:N──> t_srv6_policy        │
                      │              │               │
                      │              └──1:N──> t_tunnel
                      │
                      └──via t_vpn_pe_binding(M:N)──> t_l3vpn_service

KPI时序挂载:
  t_network_element → t_ne_perf_kpi
  t_interface       → t_interface_perf_kpi
  t_tunnel          → t_tunnel_perf_kpi
  t_l3vpn_service   → t_vpn_sla_kpi
```

---

## 二、结构化字段字典

每个字段包含：列名 | 英文术语 | 中文描述（含业务语义，可直接用于MDL Column Description） | 数据类型 | 示例值 | 值域/约束 | 来源依据

> **设计原则**：中文描述写成"LLM可直接理解业务含义"的形式；来源依据仅作溯源元数据，不直接注入LLM prompt。

---

### 表1: t_site（站点/机房）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| site_id | Site ID | 站点唯一标识，主键 | VARCHAR(64) | `SITE-BJ-001` | PK | - |
| site_name | Site Name | 站点名称，如"北京亦庄DC-01" | VARCHAR(128) | `北京亦庄DC-01`; `上海嘉定POP-03` | NOT NULL | - |
| site_code | Site Code | 站点编码，全局唯一简码 | VARCHAR(32) | `BJ-YZ-DC01`; `SH-JD-POP03` | UNIQUE, NOT NULL | - |
| site_type | Site Type | 站点类型：DC(数据中心)、POP(接入点)、CO(中心机房)、COLO(托管机房)、EDGE(边缘节点) | VARCHAR(32) | `DC`; `POP` | 枚举: DC/POP/CO/COLO/EDGE | - |
| region | Region | 所属大区，用于区域维度聚合 | VARCHAR(64) | `华北`; `华东`; `华南` | NOT NULL | - |
| province | Province | 省份 | VARCHAR(32) | `北京`; `上海`; `广东` | NOT NULL | - |
| city | City | 城市 | VARCHAR(32) | `北京`; `上海`; `广州` | NOT NULL | - |
| address | Address | 详细地址 | VARCHAR(256) | `亦庄经济开发区XX路XX号` | 可空 | - |
| longitude | Longitude | 经度坐标，WGS84 | DECIMAL(10,7) | `116.5095700` | 可空 | - |
| latitude | Latitude | 纬度坐标，WGS84 | DECIMAL(10,7) | `39.7952100` | 可空 | - |
| tier | Tier | 站点等级，TIER1为核心枢纽，TIER3为末梢接入 | VARCHAR(16) | `TIER1`; `TIER2`; `TIER3` | NOT NULL | 参考TIA-942 DC分级 |
| total_rack_count | Total Rack Count | 该站点总机柜数量 | INT | `200`; `48` | ≥0 | - |
| used_rack_count | Used Rack Count | 已使用的机柜数量 | INT | `150`; `32` | ≥0 | - |
| power_capacity_kw | Power Capacity (kW) | 站点总供电容量，单位千瓦 | DECIMAL(10,2) | `2000.00`; `500.00` | 可空, 单位:kW | - |
| cooling_type | Cooling Type | 制冷方式 | VARCHAR(32) | `AIR`; `LIQUID`; `HYBRID` | 可空 | - |
| operator | Operator | 站点运营商或承建方 | VARCHAR(64) | `中国电信`; `万国数据` | 可空 | - |
| contact_person | Contact Person | 站点联系人 | VARCHAR(64) | `张工` | 可空 | - |
| contact_phone | Contact Phone | 联系电话 | VARCHAR(32) | `13800138000` | 可空 | - |
| commissioning_date | Commissioning Date | 站点投产日期 | DATE | `2023-06-15` | 可空 | - |
| contract_expire_date | Contract Expire Date | 机房租赁合同到期日 | DATE | `2028-06-15` | 可空 | - |
| status | Status | 站点状态 | VARCHAR(16) | `ACTIVE`; `DECOMMISSIONED`; `PLANNED` | 默认ACTIVE | - |
| description | Description | 备注信息 | VARCHAR(512) | `一期已满，二期扩建中` | 可空 | - |

---

### 表2: t_network_element（网元/设备）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| ne_id | Network Element ID | 网元唯一标识，主键 | VARCHAR(64) | `NE-BJ-PE01` | PK | - |
| ne_name | NE Name | 网元名称，通常含地域和角色信息 | VARCHAR(128) | `BJ-CORE-PE01`; `SH-CORE-P01` | NOT NULL | - |
| ne_type | NE Type | 设备硬件类型 | VARCHAR(32) | `ROUTER`; `SWITCH`; `FIREWALL` | NOT NULL | - |
| vendor | Vendor | 设备厂商 | VARCHAR(32) | `HUAWEI`; `CISCO`; `ZTE` | NOT NULL | - |
| model | Model | 设备型号 | VARCHAR(64) | `NE40E-X16A`; `ASR9000`; `NE5000E` | NOT NULL | 华为/思科产品线 |
| software_version | Software Version | 设备操作系统版本 | VARCHAR(64) | `V800R023C10`; `IOS-XR 7.7.2` | 可空 | - |
| patch_version | Patch Version | 当前热补丁版本 | VARCHAR(64) | `SPC300`; `SMU-2024Q2` | 可空 | - |
| role | Role | 网元在IP骨干网中的网络角色。PE(Provider Edge)直连客户CE并承载VPN业务；P(Provider)为骨干转发节点；CE(Customer Edge)为客户侧设备；RR(Route Reflector)为路由反射器；ASBR(AS Boundary Router)为自治域边界路由器 | VARCHAR(16) | `PE`; `P`; `CE`; `RR`; `ASBR` | NOT NULL | RFC 4364 L3VPN架构 |
| management_ip | Management IP | 设备带外管理IP地址，用于SSH/NETCONF登录 | VARCHAR(64) | `10.10.1.11`; `10.10.2.21` | NOT NULL | - |
| loopback_ipv4 | Loopback IPv4 | Loopback0接口IPv4地址，通常作为Router-ID和BGP邻居地址 | VARCHAR(32) | `1.1.1.1`; `2.2.2.2` | 可空 | 华为Loopback配置实践 |
| loopback_ipv6 | Loopback IPv6 | Loopback0接口IPv6地址，SRv6场景作为Locator关联地址 | VARCHAR(64) | `2001:DB8::1`; `2001:DB8::2` | 可空 | - |
| router_id | Router-ID | OSPF/BGP的Router-ID，通常等于loopback_ipv4 | VARCHAR(32) | `1.1.1.1` | 可空 | RFC 2328(OSPF) |
| as_number | AS Number | 设备所属的BGP自治系统号 | BIGINT | `65000`; `4200000001` | 可空 | RFC 6793(4字节ASN) |
| isis_system_id | IS-IS System ID | IS-IS协议的系统标识符，6字节点分十进制格式 | VARCHAR(32) | `0100.0000.0001` | 可空 | ISO 10589 / RFC 1195 |
| isis_area_id | IS-IS Area ID | IS-IS区域标识 | VARCHAR(32) | `49.0001` | 可空 | ISO 10589 |
| srv6_locator | SRv6 Locator | SRv6 Locator前缀，标识该网元在SRv6网络中的可达地址段。其他节点通过IGP学习此前缀来定位本设备 | VARCHAR(64) | `2001:DB8:100::/48`; `2001:DB8:200::/48` | 可空 | RFC 8986(SRv6 Network Programming) |
| mpls_enabled | MPLS Enabled | 是否使能了MPLS转发 | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| srv6_enabled | SRv6 Enabled | 是否使能了SRv6（Segment Routing over IPv6） | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| netconf_enabled | NETCONF Enabled | 是否使能了NETCONF协议（用于自动化配置管理） | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | RFC 6241 |
| telemetry_enabled | Telemetry Enabled | 是否使能了Telemetry流式遥测（用于性能数据实时上报） | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| site_id | Site ID | 所属站点ID，外键关联t_site | VARCHAR(64) | `SITE-BJ-001` | FK → t_site.site_id | - |
| rack_position | Rack Position | 在站点内的机柜位置 | VARCHAR(32) | `A03-U20`; `B01-U05` | 可空 | - |
| serial_number | Serial Number | 设备序列号（厂商出厂编号） | VARCHAR(64) | `2102351GBR10KA000023` | 可空 | - |
| asset_id | Asset ID | 企业内部资产编号 | VARCHAR(64) | `ASSET-2024-00156` | 可空 | - |
| commissioning_date | Commissioning Date | 设备上线投产日期 | DATE | `2024-03-15` | 可空 | - |
| maintenance_expire | Maintenance Expire | 维保合同到期日 | DATE | `2027-03-15` | 可空 | - |
| admin_status | Admin Status | 管理状态，由运维人员手动设置 | VARCHAR(16) | `UP`; `DOWN`; `TESTING` | 默认UP | IF-MIB ifAdminStatus语义 |
| oper_status | Oper Status | 运行状态，由系统自动检测 | VARCHAR(16) | `UP`; `DOWN`; `DEGRADED` | 默认UP | IF-MIB ifOperStatus语义 |
| description | Description | 备注 | VARCHAR(512) | `核心PE，承载GOLD级VPN` | 可空 | - |

---

### 表3: t_board（单板/线卡）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| board_id | Board ID | 单板唯一标识，主键 | VARCHAR(64) | `BRD-001` | PK | - |
| ne_id | NE ID | 所属网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| slot_number | Slot Number | 槽位号，标识板卡在机框中的物理位置 | VARCHAR(16) | `1/0`; `3/0`; `5/0` | NOT NULL | - |
| board_type | Board Type | 单板类型：MPU(主控板)、LPU(业务线卡)、SFU(交换网板)、FAN(风扇框)、PWR(电源) | VARCHAR(32) | `MPU`; `LPU`; `SFU` | NOT NULL | 华为NE设备架构 |
| board_name | Board Name | 单板型号名称 | VARCHAR(128) | `CR5D00L4XF90`; `CR5DMPUA10` | 可空 | - |
| hardware_version | Hardware Version | 硬件版本 | VARCHAR(64) | `VER.B` | 可空 | - |
| firmware_version | Firmware Version | 固件版本 | VARCHAR(64) | `V200R001` | 可空 | - |
| serial_number | Serial Number | 单板序列号 | VARCHAR(64) | `210235G7HK10KA000012` | 可空 | - |
| port_count | Port Count | 该单板提供的端口数量 | INT | `36`; `4`; `0` | 默认0 | - |
| port_type | Port Type | 端口物理类型 | VARCHAR(32) | `100GE`; `400GE`; `10GE` | 可空 | - |
| forwarding_capacity_gbps | Forwarding Capacity (Gbps) | 单板转发处理能力，单位Gbps | DECIMAL(10,2) | `3600.00`; `1200.00` | 可空, 单位:Gbps | - |
| memory_total_mb | Memory Total (MB) | 单板内存总量 | INT | `32768`; `16384` | 可空, 单位:MB | - |
| temperature_threshold | Temperature Threshold (°C) | 温度告警阈值 | DECIMAL(5,2) | `75.00`; `85.00` | 可空, 单位:°C | - |
| power_consumption_w | Power Consumption (W) | 额定功耗 | DECIMAL(8,2) | `850.00`; `200.00` | 可空, 单位:W | - |
| admin_status | Admin Status | 管理状态 | VARCHAR(16) | `UP`; `DOWN`; `OFFLINE` | 默认UP | - |
| oper_status | Oper Status | 运行状态 | VARCHAR(16) | `UP`; `DOWN`; `FAULT` | 默认UP | - |
| install_date | Install Date | 板卡安装日期 | DATE | `2024-03-15` | 可空 | - |
| last_reboot_time | Last Reboot Time | 最近重启时间 | TIMESTAMP | `2025-01-10 03:00:00` | 可空 | - |
| uptime_hours | Uptime (hours) | 累计运行时长 | BIGINT | `8760`; `2160` | 默认0, 单位:小时 | - |
| description | Description | 备注 | VARCHAR(512) | `主用主控板` | 可空 | - |

---

### 表4: t_interface（接口/端口）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| if_id | Interface ID | 接口唯一标识，主键 | VARCHAR(64) | `IF-001` | PK | - |
| ne_id | NE ID | 所属网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| board_id | Board ID | 所属单板ID（物理口有值，逻辑口可空） | VARCHAR(64) | `BRD-001` | FK → t_board, 可空 | - |
| if_name | Interface Name | 接口名称，设备上的标准命名。对应YANG模型的interface name和SNMP IF-MIB的ifName | VARCHAR(128) | `GE1/0/1`; `100GE3/0/0`; `Eth-Trunk10`; `LoopBack0` | NOT NULL | RFC 8343(YANG interfaces), IF-MIB(ifName) |
| if_index | ifIndex | SNMP接口索引号，每接口唯一的正整数，设备重启后应保持稳定 | BIGINT | `1001`; `2001` | 可空 | RFC 2863(IF-MIB ifIndex) |
| if_type | Interface Type | 接口逻辑类型：PHYSICAL(物理口)、LOOPBACK、VLANIF(VLAN接口)、ETH-TRUNK(聚合口)、TUNNEL、NULL | VARCHAR(32) | `PHYSICAL`; `ETH-TRUNK`; `LOOPBACK` | NOT NULL | - |
| phy_type | Physical Type | 物理端口速率类型（仅物理口有值） | VARCHAR(32) | `GE`; `10GE`; `100GE`; `400GE` | 可空 | - |
| speed_mbps | Speed (Mbps) | 接口协商速率，单位Mbps | BIGINT | `1000`; `10000`; `100000` | 可空, 单位:Mbps | - |
| mtu | MTU | 最大传输单元，单位字节 | INT | `1500`; `9000`; `9216` | 默认1500, 单位:bytes | RFC 791 |
| ipv4_address | IPv4 Address | 接口IPv4地址 | VARCHAR(32) | `192.168.1.1`; `10.0.0.1` | 可空 | - |
| ipv4_mask | IPv4 Mask | IPv4子网掩码 | VARCHAR(32) | `255.255.255.252`; `255.255.255.0` | 可空 | - |
| ipv6_address | IPv6 Address | 接口IPv6地址 | VARCHAR(64) | `2001:DB8:10::1` | 可空 | - |
| ipv6_prefix_len | IPv6 Prefix Length | IPv6前缀长度 | INT | `64`; `126` | 可空 | - |
| mac_address | MAC Address | 接口MAC地址 | VARCHAR(32) | `00:11:22:33:44:01` | 可空 | - |
| vlan_id | VLAN ID | 接口关联的VLAN标识 | INT | `100`; `200` | 可空, 范围:1-4094 | IEEE 802.1Q |
| vrf_name | VRF Name | 接口绑定的VPN路由转发实例名称 | VARCHAR(64) | `vpn_acme`; `vpn_bank` | 可空 | RFC 4364 |
| trunk_id | Trunk ID | 所属Eth-Trunk聚合组ID（仅Trunk成员口有值） | VARCHAR(64) | `IF-TRUNK-10` | 可空 | IEEE 802.3ad(LACP) |
| trunk_member_count | Trunk Member Count | Trunk聚合组的成员口数量（仅Trunk主口有值） | INT | `4`; `8` | 可空 | - |
| isis_enabled | IS-IS Enabled | 该接口是否使能IS-IS路由协议 | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| isis_cost | IS-IS Cost | IS-IS接口开销值，值越小路径优先级越高 | INT | `10`; `100` | 可空 | ISO 10589 |
| ospf_enabled | OSPF Enabled | 该接口是否使能OSPF路由协议 | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| bfd_enabled | BFD Enabled | 是否使能BFD(双向转发检测)，用于快速链路故障检测 | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | RFC 5880 |
| qos_profile | QoS Profile | 接口应用的QoS策略模板名称 | VARCHAR(64) | `GOLD-INGRESS`; `SILVER-EGRESS` | 可空 | - |
| admin_status | Admin Status | 接口管理状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | IF-MIB ifAdminStatus |
| oper_status | Oper Status | 接口运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | IF-MIB ifOperStatus |
| last_change_time | Last Change Time | 接口最近一次状态变更时间（UP→DOWN或DOWN→UP） | TIMESTAMP | `2025-03-28 14:30:00` | 可空 | IF-MIB ifLastChange |
| description | Description | 接口描述，通常标注对端信息 | VARCHAR(512) | `TO:SH-PE01-100GE3/0/0`; `CUST:AcmeBank-CE01` | 可空 | - |

---

### 表5: t_physical_link（物理链路）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| link_id | Link ID | 链路唯一标识 | VARCHAR(64) | `LINK-001` | PK | - |
| link_name | Link Name | 链路命名 | VARCHAR(128) | `BJ-PE01<->SH-PE01` | 可空 | - |
| link_type | Link Type | 链路介质类型 | VARCHAR(32) | `FIBER`; `COPPER`; `MICROWAVE` | NOT NULL | - |
| a_ne_id | A-End NE ID | A端网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| a_if_id | A-End Interface ID | A端接口ID | VARCHAR(64) | `IF-001` | FK → t_interface | - |
| a_site_id | A-End Site ID | A端站点ID | VARCHAR(64) | `SITE-BJ-001` | FK → t_site, 可空 | - |
| z_ne_id | Z-End NE ID | Z端网元ID | VARCHAR(64) | `NE-SH-PE01` | FK → t_network_element | - |
| z_if_id | Z-End Interface ID | Z端接口ID | VARCHAR(64) | `IF-051` | FK → t_interface | - |
| z_site_id | Z-End Site ID | Z端站点ID | VARCHAR(64) | `SITE-SH-001` | FK → t_site, 可空 | - |
| bandwidth_mbps | Bandwidth (Mbps) | 链路带宽容量，单位Mbps | BIGINT | `100000`; `10000` | NOT NULL, 单位:Mbps | - |
| distance_km | Distance (km) | 链路物理距离 | DECIMAL(10,2) | `1200.50`; `0.50` | 可空, 单位:km | - |
| latency_ms | Inherent Latency (ms) | 链路固有传播时延（与距离相关，约5μs/km光纤） | DECIMAL(8,3) | `6.000`; `0.003` | 可空, 单位:ms | 光纤传播约5μs/km |
| fiber_core_count | Fiber Core Count | 光纤芯数 | INT | `48`; `12` | 可空 | - |
| wavelength_nm | Wavelength (nm) | 使用波长 | INT | `1310`; `1550` | 可空, 单位:nm | ITU-T G.694 |
| cable_id | Cable ID | 光缆/电缆编号 | VARCHAR(64) | `CAB-BJ-SH-001` | 可空 | - |
| is_intra_site | Is Intra-Site | 是否站内短距链路 | BOOLEAN | `FALSE`; `TRUE` | 默认FALSE | - |
| protection_type | Protection Type | 链路保护方式 | VARCHAR(32) | `NONE`; `1+1`; `RING` | 可空 | ITU-T G.841 |
| carrier | Carrier | 承载运营商（租用电路场景） | VARCHAR(64) | `中国电信`; `中国联通` | 可空 | - |
| circuit_id | Circuit ID | 电路编号（运营商侧） | VARCHAR(64) | `CIR-20240001` | 可空 | - |
| sla_class | SLA Class | 链路SLA等级 | VARCHAR(16) | `GOLD`; `SILVER`; `BRONZE` | 可空 | - |
| admin_status | Admin Status | 管理状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| oper_status | Oper Status | 运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| commissioning_date | Commissioning Date | 链路开通日期 | DATE | `2024-01-15` | 可空 | - |
| monthly_cost | Monthly Cost | 月租费用（租用链路），单位元 | DECIMAL(12,2) | `50000.00`; `0.00` | 可空, 单位:CNY | - |
| description | Description | 备注 | VARCHAR(512) | `骨干核心链路` | 可空 | - |

---

### 表6: t_vrf_instance（VRF实例）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| vrf_id | VRF ID | VRF实例唯一标识 | VARCHAR(64) | `VRF-001` | PK | - |
| ne_id | NE ID | 所属网元ID（VRF配置在PE上） | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| vrf_name | VRF Name | VRF实例名称，对应设备上的VPN-Instance名称 | VARCHAR(64) | `vpn_acme`; `vpn_bank` | NOT NULL | 华为VPN-Instance配置 |
| route_distinguisher | Route Distinguisher (RD) | 路由标识符，8字节，用于区分不同VPN中重叠的IP地址空间。格式为ASN:nn或IP:nn | VARCHAR(32) | `65000:100`; `1.1.1.1:10` | 可空 | RFC 4364(BGP/MPLS IP VPN) |
| vpn_target_import | RT Import | 导入路由目标列表，决定哪些远端PE的路由会被导入本VRF | VARCHAR(256) | `65000:100`; `65000:100,65000:200` | 可空, 逗号分隔 | RFC 4364(Route Target属性) |
| vpn_target_export | RT Export | 导出路由目标列表，标记本VRF发布的路由应被哪些远端VRF接收 | VARCHAR(256) | `65000:100` | 可空, 逗号分隔 | RFC 4364(Route Target属性) |
| address_family | Address Family | 地址族 | VARCHAR(16) | `IPV4`; `IPV6`; `DUAL` | 默认IPV4 | - |
| label_mode | Label Mode | MPLS标签分配模式 | VARCHAR(16) | `PER_INSTANCE`; `PER_ROUTE` | 可空 | RFC 4364 |
| tunnel_policy | Tunnel Policy | 隧道策略名称，决定VPN流量选择哪种隧道承载（SRv6/MPLS TE/LDP等） | VARCHAR(64) | `TP-SRV6-TE`; `TP-LDP` | 可空 | 华为Tunnel Policy配置 |
| srv6_locator | SRv6 Locator | VPN实例绑定的SRv6 Locator | VARCHAR(64) | `2001:DB8:100::/48` | 可空 | RFC 8986 |
| srv6_sid_end_dt4 | End.DT4 SID | SRv6 End.DT4 SID，用于将收到的SRv6报文解封装后查IPv4 VRF路由表转发 | VARCHAR(64) | `2001:DB8:100::11` | 可空 | RFC 8986(SRv6 End.DT4功能) |
| srv6_sid_end_dt6 | End.DT6 SID | SRv6 End.DT6 SID，类似End.DT4但用于IPv6 VRF | VARCHAR(64) | `2001:DB8:100::12` | 可空 | RFC 8986(SRv6 End.DT6功能) |
| evpn_type | EVPN Type | EVPN业务类型 | VARCHAR(16) | `NONE`; `L2`; `L3`; `VPWS` | 可空 | RFC 7432(EVPN) |
| max_routes | Max Routes | VRF允许的最大路由条数上限 | INT | `10000`; `5000` | 可空 | - |
| current_route_count | Current Route Count | 当前实际路由条数 | INT | `3500`; `120` | 默认0 | - |
| associated_if_count | Associated Interface Count | 关联到该VRF的接口数量 | INT | `5`; `2` | 默认0 | - |
| customer_id | Customer ID | 客户编号 | VARCHAR(64) | `CUST-001` | 可空 | - |
| customer_name | Customer Name | 客户名称 | VARCHAR(128) | `Acme银行`; `MediaCorp` | 可空 | - |
| service_type | Service Type | 业务类型 | VARCHAR(32) | `MPLS_VPN`; `CLOUD_CONNECT`; `INTERNET` | 可空 | - |
| admin_status | Admin Status | 管理状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| oper_status | Oper Status | 运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| description | Description | 备注 | VARCHAR(512) | `Acme银行总部接入VRF` | 可空 | - |

---

### 表7: t_l3vpn_service（L3VPN业务）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| vpn_id | VPN ID | VPN业务唯一标识 | VARCHAR(64) | `VPN-001` | PK | - |
| vpn_name | VPN Name | VPN业务名称 | VARCHAR(128) | `ACME-BANK-VPN`; `MEDIA-CORP-VPN` | NOT NULL | - |
| vpn_type | VPN Type | VPN业务类型 | VARCHAR(32) | `L3VPN`; `EVPN_L3`; `EVPN_VPWS` | NOT NULL | RFC 4364; RFC 7432 |
| topology | Topology | VPN拓扑模型 | VARCHAR(16) | `ANY_TO_ANY`; `HUB_SPOKE`; `P2P` | 默认ANY_TO_ANY | - |
| customer_id | Customer ID | 客户编号 | VARCHAR(64) | `CUST-001` | NOT NULL | - |
| customer_name | Customer Name | 客户名称 | VARCHAR(128) | `Acme银行` | NOT NULL | - |
| service_level | Service Level | 服务等级，决定SLA保证水平和QoS优先级 | VARCHAR(16) | `PLATINUM`; `GOLD`; `SILVER`; `BRONZE` | 默认SILVER | - |
| bandwidth_mbps | Guaranteed Bandwidth (Mbps) | SLA保证带宽 | BIGINT | `1000`; `100` | 可空, 单位:Mbps | - |
| max_latency_ms | Max Latency SLA (ms) | SLA承诺最大端到端时延 | DECIMAL(8,3) | `20.000`; `50.000` | 可空, 单位:ms | - |
| max_jitter_ms | Max Jitter SLA (ms) | SLA承诺最大抖动 | DECIMAL(8,3) | `5.000`; `10.000` | 可空, 单位:ms | - |
| max_packet_loss_pct | Max Packet Loss SLA (%) | SLA承诺最大丢包率 | DECIMAL(5,4) | `0.0100`; `0.1000` | 可空, 单位:% | - |
| pe_count | PE Count | 关联的PE设备数量 | INT | `5`; `2` | 默认0 | - |
| site_count | Site Count | 覆盖的客户站点数量 | INT | `10`; `3` | 默认0 | - |
| underlay_type | Underlay Type | 承载隧道类型，决定VPN流量使用哪种底层传输技术 | VARCHAR(32) | `SRV6_BE`; `SRV6_TE`; `MPLS_LDP`; `MPLS_TE` | 默认SRV6_BE | 华为NCE-IP隧道策略 |
| encryption_enabled | Encryption Enabled | 是否启用IPSec加密 | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| multicast_enabled | Multicast Enabled | 是否启用组播 | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| route_distinguisher | Route Distinguisher | 全局RD | VARCHAR(32) | `65000:100` | 可空 | RFC 4364 |
| vpn_target | VPN Target (RT) | RT配置 | VARCHAR(256) | `65000:100` | 可空 | RFC 4364 |
| contract_start_date | Contract Start | 合同起始日期 | DATE | `2024-01-01` | 可空 | - |
| contract_end_date | Contract End | 合同结束日期 | DATE | `2027-01-01` | 可空 | - |
| monthly_fee | Monthly Fee | 月租费，单位元 | DECIMAL(12,2) | `150000.00`; `20000.00` | 可空, 单位:CNY | - |
| admin_status | Admin Status | 业务管理状态 | VARCHAR(16) | `ACTIVE`; `SUSPENDED`; `TERMINATED` | 默认ACTIVE | - |
| oper_status | Oper Status | 业务运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| deploy_status | Deploy Status | 部署状态 | VARCHAR(16) | `DEPLOYED`; `DEPLOYING`; `PLANNED`; `FAILED` | 默认DEPLOYED | - |
| last_audit_time | Last Audit Time | 最近配置审计时间 | TIMESTAMP | `2025-03-01 10:00:00` | 可空 | - |
| description | Description | 备注 | VARCHAR(512) | `金融专线VPN` | 可空 | - |

---

### 表8: t_vpn_pe_binding（VPN-PE绑定关系）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| binding_id | Binding ID | 绑定记录唯一标识 | VARCHAR(64) | `BIND-001` | PK | - |
| vpn_id | VPN ID | VPN业务ID | VARCHAR(64) | `VPN-001` | FK → t_l3vpn_service | - |
| ne_id | NE ID | PE网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| vrf_id | VRF ID | 该PE上对应的VRF实例ID | VARCHAR(64) | `VRF-001` | FK → t_vrf_instance | - |
| if_id | Interface ID | PE侧接入接口ID（连接CE的接口） | VARCHAR(64) | `IF-010` | FK → t_interface | - |
| pe_role | PE Role | 该PE在VPN中的角色（Hub-Spoke拓扑下区分Hub/Spoke） | VARCHAR(16) | `HUB`; `SPOKE` | 默认SPOKE | - |
| ce_ipv4 | CE IPv4 | CE侧接口IPv4地址 | VARCHAR(32) | `192.168.1.2` | 可空 | - |
| pe_ipv4 | PE IPv4 | PE侧接口IPv4地址 | VARCHAR(32) | `192.168.1.1` | 可空 | - |
| ce_ipv6 | CE IPv6 | CE侧接口IPv6 | VARCHAR(64) | `2001:DB8:C::2` | 可空 | - |
| pe_ipv6 | PE IPv6 | PE侧接口IPv6 | VARCHAR(64) | `2001:DB8:C::1` | 可空 | - |
| ce_as_number | CE AS Number | CE侧BGP AS号（EBGP接入场景） | BIGINT | `65100`; `65200` | 可空 | - |
| routing_protocol | Routing Protocol | PE-CE之间使用的路由协议 | VARCHAR(16) | `STATIC`; `EBGP`; `OSPF` | 默认STATIC | RFC 4364 |
| access_bandwidth_mbps | Access Bandwidth (Mbps) | 接入带宽 | BIGINT | `1000`; `100` | 可空, 单位:Mbps | - |
| vlan_id | VLAN ID | 接入VLAN | INT | `100`; `200` | 可空 | IEEE 802.1Q |
| encapsulation | Encapsulation | 封装类型 | VARCHAR(32) | `DOT1Q`; `UNTAG`; `QINQ` | 默认DOT1Q | IEEE 802.1Q / 802.1ad |
| site_name | Site Name | 接入站点名称（业务视角） | VARCHAR(128) | `Acme银行北京总部` | 可空 | - |
| admin_status | Admin Status | 管理状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| oper_status | Oper Status | 运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| description | Description | 备注 | VARCHAR(512) | `总部主接入` | 可空 | - |

---

### 表9: t_srv6_policy（SRv6 TE Policy）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| policy_id | Policy ID | SRv6 Policy唯一标识 | VARCHAR(64) | `POL-001` | PK | - |
| policy_name | Policy Name | Policy名称 | VARCHAR(128) | `SRv6-TE-BJ-SH-LOW-LATENCY` | NOT NULL | - |
| source_ne_id | Source NE ID | 源端网元(头节点)ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| endpoint_ipv6 | Endpoint IPv6 | Policy的Endpoint地址，标识尾节点 | VARCHAR(64) | `2001:DB8:200::1` | NOT NULL | RFC 9256(SR Policy Architecture) |
| dest_ne_id | Destination NE ID | 目的网元ID | VARCHAR(64) | `NE-SH-PE01` | FK → t_network_element, 可空 | - |
| color | Color | Color值，标识SLA意图（不同Color表示不同SLA需求，如低时延/高带宽） | BIGINT | `10`; `20`; `100` | NOT NULL | RFC 9256(SR Policy = <headend, color, endpoint>) |
| distinguisher | Distinguisher | 区分相同Color+Endpoint的不同Policy | BIGINT | `0`; `1` | 默认0 | RFC 9256 |
| binding_sid | Binding SID | 绑定SID(BSID)，用于SRH压缩，一个BSID代表一段完整的SRv6路径 | VARCHAR(64) | `2001:DB8:100::FF` | 可空 | RFC 8402(Binding SID) |
| preference | Preference | 候选路径优先级，值越大越优先 | INT | `100`; `200` | 默认100 | RFC 9256 |
| segment_list_count | Segment List Count | Segment List数量 | INT | `1`; `2` | 默认1 | - |
| segment_list | Segment List | SID序列（JSON格式），定义报文经过的SRv6节点路径。列表中SID的顺序即为转发路径顺序 | TEXT | `["2001:DB8:100::1","2001:DB8:300::1","2001:DB8:200::1"]` | 可空 | RFC 8986(SRv6 SID List编码) |
| explicit_path | Explicit Path | 是否显式指定路径（非动态计算） | BOOLEAN | `TRUE`; `FALSE` | 默认FALSE | - |
| provision_type | Provision Type | 部署方式 | VARCHAR(16) | `STATIC`; `DYNAMIC`; `CONTROLLER` | 默认DYNAMIC | 华为NCE-IP SRv6 Policy部署方式 |
| sla_type | SLA Type | SLA优化目标 | VARCHAR(32) | `LOW_LATENCY`; `LOW_JITTER`; `HIGH_BW` | 可空 | - |
| max_latency_ms | Max Latency Constraint (ms) | 路径最大时延约束 | DECIMAL(8,3) | `20.000` | 可空, 单位:ms | - |
| max_jitter_ms | Max Jitter Constraint (ms) | 路径最大抖动约束 | DECIMAL(8,3) | `5.000` | 可空, 单位:ms | - |
| min_bandwidth_mbps | Min Bandwidth Constraint (Mbps) | 路径最小带宽约束 | BIGINT | `10000` | 可空, 单位:Mbps | - |
| hop_count | Hop Count | 路径跳数 | INT | `3`; `5` | 可空 | - |
| associated_vpn_count | Associated VPN Count | 该Policy承载的VPN业务数量 | INT | `3`; `0` | 默认0 | - |
| ecmp_count | ECMP Count | 等价多路径数量 | INT | `1`; `2` | 默认1 | - |
| admin_status | Admin Status | 管理状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| oper_status | Oper Status | 运行状态 | VARCHAR(16) | `UP`; `DOWN`; `PARTIAL` | 默认UP | - |
| deploy_source | Deploy Source | 部署来源 | VARCHAR(32) | `NCE`; `CLI`; `PCEP` | 可空 | - |
| description | Description | 备注 | VARCHAR(512) | `北京→上海低时延路径` | 可空 | - |

---

### 表10: t_tunnel（隧道）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| tunnel_id | Tunnel ID | 隧道唯一标识 | VARCHAR(64) | `TUN-001` | PK | - |
| tunnel_name | Tunnel Name | 隧道名称 | VARCHAR(128) | `SRv6-TE-BJ-SH-001` | NOT NULL | - |
| tunnel_type | Tunnel Type | 隧道类型 | VARCHAR(32) | `SRV6_BE`; `SRV6_TE`; `MPLS_LDP`; `MPLS_TE`; `GRE` | NOT NULL | - |
| source_ne_id | Source NE ID | 源端网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| source_ip | Source IP | 源端IP/IPv6 | VARCHAR(64) | `2001:DB8::1` | 可空 | - |
| dest_ne_id | Destination NE ID | 宿端网元ID | VARCHAR(64) | `NE-SH-PE01` | FK → t_network_element | - |
| dest_ip | Destination IP | 宿端IP/IPv6 | VARCHAR(64) | `2001:DB8::2` | 可空 | - |
| policy_id | Policy ID | 关联SRv6 Policy ID（SRv6 TE隧道） | VARCHAR(64) | `POL-001` | FK → t_srv6_policy, 可空 | - |
| tunnel_if_id | Tunnel Interface ID | 关联的Tunnel逻辑接口ID | VARCHAR(64) | `IF-TUN-001` | 可空 | - |
| bandwidth_mbps | Bandwidth (Mbps) | 隧道配置带宽 | BIGINT | `10000` | 可空, 单位:Mbps | - |
| measured_latency_ms | Measured Latency (ms) | 实测时延（iFIT/TWAMP检测值） | DECIMAL(8,3) | `12.500` | 可空, 单位:ms | 华为iFIT带内检测 |
| measured_jitter_ms | Measured Jitter (ms) | 实测抖动 | DECIMAL(8,3) | `1.200` | 可空, 单位:ms | - |
| path_hop_count | Path Hop Count | 路径跳数 | INT | `3`; `5` | 可空 | - |
| protection_type | Protection Type | 保护类型 | VARCHAR(32) | `NONE`; `HOT_STANDBY`; `TI_LFA`; `FRR` | 默认NONE | RFC 7490(TI-LFA); RFC 4090(FRR) |
| is_bidirectional | Is Bidirectional | 是否双向隧道 | BOOLEAN | `TRUE`; `FALSE` | 默认TRUE | - |
| associated_vpn_ids | Associated VPN IDs | 承载的VPN ID列表（JSON） | TEXT | `["VPN-001","VPN-002"]` | 可空 | - |
| tunnel_group_id | Tunnel Group ID | 隧道组ID（Policy Group场景） | VARCHAR(64) | `TG-001` | 可空 | 华为SRv6 Policy Group |
| group_type | Group Type | 隧道组类型 | VARCHAR(32) | `ANY_TO_ANY`; `HUB_SPOKE` | 可空 | - |
| signaling_protocol | Signaling Protocol | 信令协议 | VARCHAR(32) | `BGP_SR_POLICY`; `PCEP`; `RSVP_TE`; `STATIC` | 可空 | - |
| admin_status | Admin Status | 管理状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| oper_status | Oper Status | 运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| setup_priority | Setup Priority | 建立优先级(0最高, 7最低) | INT | `7`; `0` | 默认7, 范围:0-7 | RFC 3209(RSVP-TE) |
| hold_priority | Hold Priority | 维持优先级 | INT | `7`; `0` | 默认7, 范围:0-7 | RFC 3209 |
| description | Description | 备注 | VARCHAR(512) | `低时延TE隧道` | 可空 | - |

---

### 表11: t_ne_perf_kpi（网元性能KPI）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| kpi_id | KPI ID | 记录ID | BIGSERIAL | `1` | PK, 自增 | - |
| ne_id | NE ID | 网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element, IDX | - |
| collect_time | Collection Time | 采集时间点 | TIMESTAMP | `2025-03-29 08:00:00` | NOT NULL, IDX | - |
| granularity_min | Granularity (min) | 采集粒度，单位分钟 | INT | `15`; `5`; `60` | 默认15 | - |
| cpu_usage_avg_pct | CPU Usage Avg (%) | CPU平均利用率 | DECIMAL(5,2) | `45.20`; `92.50` | 可空, 单位:%, 范围:0-100 | SNMP HOST-RESOURCES-MIB |
| cpu_usage_max_pct | CPU Usage Max (%) | CPU峰值利用率 | DECIMAL(5,2) | `78.00`; `99.00` | 可空, 单位:% | - |
| memory_usage_avg_pct | Memory Usage Avg (%) | 内存平均利用率 | DECIMAL(5,2) | `60.30` | 可空, 单位:% | - |
| memory_usage_max_pct | Memory Usage Max (%) | 内存峰值利用率 | DECIMAL(5,2) | `72.00` | 可空, 单位:% | - |
| temperature_avg_c | Temperature Avg (°C) | 设备平均温度 | DECIMAL(5,2) | `42.50` | 可空, 单位:°C | - |
| temperature_max_c | Temperature Max (°C) | 设备最高温度 | DECIMAL(5,2) | `55.00` | 可空, 单位:°C | - |
| power_consumption_w | Power Consumption (W) | 实际功耗 | DECIMAL(8,2) | `1250.00` | 可空, 单位:W | - |
| fan_speed_rpm | Fan Speed (RPM) | 风扇转速 | INT | `6500`; `8000` | 可空, 单位:RPM | - |
| uptime_seconds | Uptime (seconds) | 运行时长 | BIGINT | `31536000` | 可空, 单位:秒 | IF-MIB sysUpTime语义 |
| fib_usage_count | FIB Usage Count | FIB(转发信息表)已用条目数 | INT | `250000` | 可空 | - |
| fib_capacity | FIB Capacity | FIB表总容量 | INT | `2000000` | 可空 | - |
| arp_entry_count | ARP Entry Count | ARP表项数 | INT | `5000` | 可空 | - |
| route_count_ipv4 | IPv4 Route Count | IPv4路由表条目数 | INT | `750000` | 可空 | - |
| route_count_ipv6 | IPv6 Route Count | IPv6路由表条目数 | INT | `120000` | 可空 | - |
| bgp_peer_up_count | BGP Peer Up Count | BGP邻居处于Established状态的数量 | INT | `25`; `23` | 可空 | - |
| bgp_peer_total_count | BGP Peer Total Count | BGP邻居配置总数 | INT | `25` | 可空 | - |
| isis_adj_up_count | IS-IS Adjacency Up Count | IS-IS邻接关系UP的数量 | INT | `4`; `3` | 可空 | - |
| alarm_critical_count | Critical Alarm Count | 当前紧急告警数 | INT | `0`; `2` | 默认0 | - |
| alarm_major_count | Major Alarm Count | 当前重要告警数 | INT | `1`; `0` | 默认0 | - |
| alarm_minor_count | Minor Alarm Count | 当前次要告警数 | INT | `3`; `0` | 默认0 | - |

---

### 表12: t_interface_perf_kpi（接口性能KPI）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| kpi_id | KPI ID | 记录ID | BIGSERIAL | `1` | PK, 自增 | - |
| if_id | Interface ID | 接口ID | VARCHAR(64) | `IF-001` | FK → t_interface, IDX | - |
| ne_id | NE ID | 网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element, IDX | - |
| collect_time | Collection Time | 采集时间 | TIMESTAMP | `2025-03-29 08:00:00` | NOT NULL, IDX | - |
| granularity_min | Granularity (min) | 采集粒度 | INT | `15` | 默认15, 单位:分钟 | - |
| in_octets | In Octets | 入方向字节数（采集周期内增量） | BIGINT | `9000000000` | 默认0, 单位:bytes | IF-MIB ifHCInOctets |
| out_octets | Out Octets | 出方向字节数 | BIGINT | `12000000000` | 默认0, 单位:bytes | IF-MIB ifHCOutOctets |
| in_packets | In Packets | 入方向总包数 | BIGINT | `6000000` | 默认0 | - |
| out_packets | Out Packets | 出方向总包数 | BIGINT | `8000000` | 默认0 | - |
| in_unicast_packets | In Unicast Packets | 入方向单播包数 | BIGINT | `5800000` | 默认0 | IF-MIB ifHCInUcastPkts |
| out_unicast_packets | Out Unicast Packets | 出方向单播包数 | BIGINT | `7700000` | 默认0 | IF-MIB ifHCOutUcastPkts |
| in_multicast_packets | In Multicast Packets | 入方向组播包数 | BIGINT | `100000` | 默认0 | - |
| out_multicast_packets | Out Multicast Packets | 出方向组播包数 | BIGINT | `150000` | 默认0 | - |
| in_broadcast_packets | In Broadcast Packets | 入方向广播包数 | BIGINT | `50000` | 默认0 | - |
| out_broadcast_packets | Out Broadcast Packets | 出方向广播包数 | BIGINT | `60000` | 默认0 | - |
| in_bandwidth_usage_pct | In Bandwidth Usage (%) | 入方向带宽利用率 = in_octets×8 / (speed_mbps×10^6×采集间隔秒) × 100 | DECIMAL(5,2) | `45.20`; `92.50` | 默认0, 单位:% | - |
| out_bandwidth_usage_pct | Out Bandwidth Usage (%) | 出方向带宽利用率 | DECIMAL(5,2) | `60.80` | 默认0, 单位:% | - |
| in_peak_rate_mbps | In Peak Rate (Mbps) | 入方向峰值速率 | DECIMAL(12,2) | `85000.00` | 可空, 单位:Mbps | - |
| out_peak_rate_mbps | Out Peak Rate (Mbps) | 出方向峰值速率 | DECIMAL(12,2) | `92000.00` | 可空, 单位:Mbps | - |
| in_error_packets | In Error Packets | 入方向错误包数（CRC错误、帧错误等） | BIGINT | `0`; `150` | 默认0 | IF-MIB ifInErrors |
| out_error_packets | Out Error Packets | 出方向错误包数 | BIGINT | `0`; `10` | 默认0 | IF-MIB ifOutErrors |
| in_discard_packets | In Discard Packets | 入方向丢弃包数（队列溢出等） | BIGINT | `0`; `5000` | 默认0 | IF-MIB ifInDiscards |
| out_discard_packets | Out Discard Packets | 出方向丢弃包数 | BIGINT | `0`; `3000` | 默认0 | IF-MIB ifOutDiscards |
| crc_error_count | CRC Error Count | CRC校验错误数 | BIGINT | `0`; `100` | 默认0 | - |
| oper_status | Oper Status | 采集时刻的接口运行状态快照 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |

---

### 表13: t_tunnel_perf_kpi（隧道性能KPI）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| kpi_id | KPI ID | 记录ID | BIGSERIAL | `1` | PK | - |
| tunnel_id | Tunnel ID | 隧道ID | VARCHAR(64) | `TUN-001` | FK → t_tunnel, IDX | - |
| source_ne_id | Source NE ID | 源网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element | - |
| dest_ne_id | Destination NE ID | 宿网元ID | VARCHAR(64) | `NE-SH-PE01` | FK → t_network_element | - |
| collect_time | Collection Time | 采集时间 | TIMESTAMP | `2025-03-29 08:00:00` | NOT NULL, IDX | - |
| granularity_min | Granularity (min) | 采集粒度 | INT | `15` | 默认15, 单位:分钟 | - |
| latency_avg_ms | Latency Avg (ms) | 平均单向时延 | DECIMAL(8,3) | `12.500`; `80.000` | 可空, 单位:ms | 华为iFIT带内时延检测 |
| latency_max_ms | Latency Max (ms) | 最大时延 | DECIMAL(8,3) | `18.200` | 可空, 单位:ms | - |
| latency_min_ms | Latency Min (ms) | 最小时延 | DECIMAL(8,3) | `10.100` | 可空, 单位:ms | - |
| jitter_avg_ms | Jitter Avg (ms) | 平均抖动（时延变化量） | DECIMAL(8,3) | `1.200` | 可空, 单位:ms | - |
| jitter_max_ms | Jitter Max (ms) | 最大抖动 | DECIMAL(8,3) | `3.500` | 可空, 单位:ms | - |
| packet_loss_rate_pct | Packet Loss Rate (%) | 丢包率 | DECIMAL(5,4) | `0.0100`; `0.5000` | 可空, 单位:% | - |
| forward_octets | Forward Octets | 转发字节数 | BIGINT | `50000000000` | 默认0, 单位:bytes | - |
| forward_packets | Forward Packets | 转发包数 | BIGINT | `35000000` | 默认0 | - |
| bandwidth_usage_pct | Bandwidth Usage (%) | 隧道带宽利用率 | DECIMAL(5,2) | `55.00` | 可空, 单位:% | - |
| rtt_avg_ms | RTT Avg (ms) | 平均往返时延(Round-Trip Time) | DECIMAL(8,3) | `25.000` | 可空, 单位:ms | - |
| rtt_max_ms | RTT Max (ms) | 最大RTT | DECIMAL(8,3) | `36.000` | 可空, 单位:ms | - |
| path_change_count | Path Change Count | 采集周期内路径变更次数 | INT | `0`; `2` | 默认0 | - |
| oper_status | Oper Status | 采集时刻隧道运行状态 | VARCHAR(16) | `UP`; `DOWN` | 默认UP | - |
| sla_violation | SLA Violation | 该采集周期是否发生SLA违规 | BOOLEAN | `FALSE`; `TRUE` | 默认FALSE | - |
| sla_violation_type | SLA Violation Type | 违规指标类型（可多值逗号分隔） | VARCHAR(64) | `LATENCY`; `JITTER,LOSS` | 可空 | - |

---

### 表14: t_vpn_sla_kpi（VPN SLA KPI）

| 列名 | 英文术语 | 中文描述 | 数据类型 | 示例值 | 值域/约束 | 来源依据 |
|------|---------|---------|----------|--------|----------|---------|
| kpi_id | KPI ID | 记录ID | BIGSERIAL | `1` | PK | - |
| vpn_id | VPN ID | VPN业务ID | VARCHAR(64) | `VPN-001` | FK → t_l3vpn_service, IDX | - |
| pe_ne_id | PE NE ID | 测量发起PE的网元ID | VARCHAR(64) | `NE-BJ-PE01` | FK → t_network_element, IDX | - |
| remote_pe_ne_id | Remote PE NE ID | 对端PE网元ID | VARCHAR(64) | `NE-SH-PE01` | FK → t_network_element, 可空 | - |
| collect_time | Collection Time | 采集时间 | TIMESTAMP | `2025-03-29 08:00:00` | NOT NULL, IDX | - |
| granularity_min | Granularity (min) | 采集粒度 | INT | `15` | 默认15, 单位:分钟 | - |
| e2e_latency_avg_ms | E2E Latency Avg (ms) | 端到端平均时延 | DECIMAL(8,3) | `15.000` | 可空, 单位:ms | - |
| e2e_latency_max_ms | E2E Latency Max (ms) | 端到端最大时延 | DECIMAL(8,3) | `22.000` | 可空, 单位:ms | - |
| e2e_jitter_avg_ms | E2E Jitter Avg (ms) | 端到端平均抖动 | DECIMAL(8,3) | `2.000` | 可空, 单位:ms | - |
| e2e_jitter_max_ms | E2E Jitter Max (ms) | 端到端最大抖动 | DECIMAL(8,3) | `5.000` | 可空, 单位:ms | - |
| e2e_packet_loss_pct | E2E Packet Loss (%) | 端到端丢包率 | DECIMAL(5,4) | `0.0050` | 可空, 单位:% | - |
| availability_pct | Availability (%) | 可用率 | DECIMAL(6,3) | `99.950`; `98.500` | 可空, 单位:% | - |
| throughput_mbps | Throughput (Mbps) | 实际吞吐量 | DECIMAL(12,2) | `800.00` | 可空, 单位:Mbps | - |
| vpn_route_count | VPN Route Count | VPN路由条数 | INT | `3500` | 可空 | - |
| route_flap_count | Route Flap Count | 路由震荡(频繁UP/DOWN)次数 | INT | `0`; `5` | 默认0 | - |
| sla_latency_met | SLA Latency Met | 时延SLA是否达标 | BOOLEAN | `TRUE`; `FALSE` | 默认TRUE | - |
| sla_jitter_met | SLA Jitter Met | 抖动SLA是否达标 | BOOLEAN | `TRUE`; `FALSE` | 默认TRUE | - |
| sla_loss_met | SLA Loss Met | 丢包SLA是否达标 | BOOLEAN | `TRUE`; `FALSE` | 默认TRUE | - |
| sla_availability_met | SLA Availability Met | 可用率SLA是否达标 | BOOLEAN | `TRUE`; `FALSE` | 默认TRUE | - |
| sla_overall_met | SLA Overall Met | 综合SLA是否全部达标（全部子项均达标时为TRUE） | BOOLEAN | `TRUE`; `FALSE` | 默认TRUE | - |
| mos_score | MOS Score | 平均意见得分（VoIP场景下的语音质量评分） | DECIMAL(3,2) | `4.20`; `3.50` | 可空, 范围:1.0-5.0 | ITU-T P.800 |
| qos_class_applied | QoS Class Applied | 实际应用的QoS策略等级 | VARCHAR(32) | `EF`; `AF41`; `BE` | 可空 | RFC 2474(DiffServ) |

---

## 三、问答对测试套件（BIRD难度分级）

### 难度定义
- **Easy**：单表，简单WHERE/聚合
- **Medium**：2-3表JOIN，GROUP BY/HAVING/子查询
- **Hard**：3+表JOIN，CTE/窗口函数/复杂业务逻辑
- **Extra Hard**：多CTE嵌套、隐含语义推断、跨OLTP-OLAP关联

---

### Q01 [Easy] 单表过滤

**问题**：查询所有华为厂商的PE设备，要求运行状态正常。

**隐含知识**："华为"→vendor='HUAWEI'；"PE设备"→role='PE'；"运行状态正常"→oper_status='UP'

```sql
SELECT ne_id, ne_name, model, management_ip, loopback_ipv4
FROM t_network_element
WHERE vendor = 'HUAWEI' AND role = 'PE' AND oper_status = 'UP';
```

---

### Q02 [Easy] 单表聚合

**问题**：统计每个大区有多少个TIER1级别的站点。

```sql
SELECT region, COUNT(*) AS tier1_count
FROM t_site
WHERE tier = 'TIER1'
GROUP BY region
ORDER BY tier1_count DESC;
```

---

### Q03 [Easy] 单表条件计数

**问题**：当前有多少条SRv6 Policy处于DOWN状态？

**隐含知识**："SRv6 Policy"→t_srv6_policy表

```sql
SELECT COUNT(*) AS down_policy_count
FROM t_srv6_policy
WHERE oper_status = 'DOWN';
```

---

### Q04 [Medium] 两表JOIN

**问题**：查询北京市所有网元的名称、型号和所在站点名称。

**隐含知识**：地理过滤在t_site上，需JOIN

```sql
SELECT ne.ne_name, ne.model, ne.role, s.site_name
FROM t_network_element ne
JOIN t_site s ON ne.site_id = s.site_id
WHERE s.city = '北京';
```

---

### Q05 [Medium] 两表JOIN + HAVING

**问题**：哪些设备的100GE物理端口数量超过10个？

**隐含知识**："100GE物理端口"→phy_type='100GE' AND if_type='PHYSICAL'（排除逻辑口）

```sql
SELECT ne.ne_name, ne.model, COUNT(*) AS port_100ge_count
FROM t_network_element ne
JOIN t_interface i ON ne.ne_id = i.ne_id
WHERE i.phy_type = '100GE' AND i.if_type = 'PHYSICAL'
GROUP BY ne.ne_name, ne.model
HAVING COUNT(*) > 10
ORDER BY port_100ge_count DESC;
```

---

### Q06 [Medium] 三表JOIN + 业务理解

**问题**：查询使用SRv6 TE承载的所有L3VPN业务及其关联的PE设备名称。

**隐含知识**："SRv6 TE承载"→underlay_type='SRV6_TE'；需经过vpn_pe_binding桥接表

```sql
SELECT v.vpn_name, v.customer_name, v.service_level,
       ne.ne_name AS pe_name, ne.management_ip
FROM t_l3vpn_service v
JOIN t_vpn_pe_binding b ON v.vpn_id = b.vpn_id
JOIN t_network_element ne ON b.ne_id = ne.ne_id
WHERE v.underlay_type = 'SRV6_TE' AND v.admin_status = 'ACTIVE';
```

---

### Q07 [Medium] OLAP时间过滤 + 聚合

**问题**：查询过去24小时CPU平均利用率超过80%的网元。

**隐含知识**：时间范围理解；OLTP+OLAP JOIN

```sql
SELECT ne.ne_name, ne.model, ne.role,
       AVG(k.cpu_usage_avg_pct) AS avg_cpu,
       MAX(k.cpu_usage_max_pct) AS peak_cpu
FROM t_ne_perf_kpi k
JOIN t_network_element ne ON k.ne_id = ne.ne_id
WHERE k.collect_time >= NOW() - INTERVAL '24 hours'
GROUP BY ne.ne_name, ne.model, ne.role
HAVING AVG(k.cpu_usage_avg_pct) > 80
ORDER BY avg_cpu DESC;
```

---

### Q08 [Hard] 多表JOIN + SLA违规检测

**问题**：找出GOLD级别VPN业务中，隧道实测时延超过SLA要求的记录。

**隐含知识**：需关联VPN→隧道→隧道KPI链路；SLA阈值在t_l3vpn_service.max_latency_ms上；隧道与VPN的关联是"软关联"（通过associated_vpn_ids或underlay_type推断）

```sql
SELECT v.vpn_name, v.max_latency_ms AS sla_limit,
       t.tunnel_name, tp.latency_avg_ms AS actual_latency,
       ne_s.ne_name AS source, ne_d.ne_name AS dest
FROM t_l3vpn_service v
JOIN t_tunnel t ON t.associated_vpn_ids LIKE CONCAT('%', v.vpn_id, '%')
JOIN t_tunnel_perf_kpi tp ON t.tunnel_id = tp.tunnel_id
JOIN t_network_element ne_s ON t.source_ne_id = ne_s.ne_id
JOIN t_network_element ne_d ON t.dest_ne_id = ne_d.ne_id
WHERE v.service_level = 'GOLD' AND v.admin_status = 'ACTIVE'
  AND tp.collect_time = (SELECT MAX(collect_time) FROM t_tunnel_perf_kpi WHERE tunnel_id = t.tunnel_id)
  AND tp.latency_avg_ms > v.max_latency_ms;
```

**诊断价值**：隧道→VPN的软关联（JSON字段匹配）是NL2SQL的高难度场景，正是溯因蒸馏要解决的E_s\E_q问题。

---

### Q09 [Hard] CTE + CASE WHEN分桶

**问题**：统计每台PE设备上所有物理接口的带宽利用率分布（空闲<30%/正常30-70%/繁忙70-90%/过载>90%），只看最新一个采集周期。

```sql
WITH latest AS (SELECT MAX(collect_time) AS t FROM t_interface_perf_kpi)
SELECT ne.ne_name,
  COUNT(CASE WHEN k.out_bandwidth_usage_pct < 30 THEN 1 END) AS idle,
  COUNT(CASE WHEN k.out_bandwidth_usage_pct BETWEEN 30 AND 70 THEN 1 END) AS normal,
  COUNT(CASE WHEN k.out_bandwidth_usage_pct BETWEEN 70 AND 90 THEN 1 END) AS busy,
  COUNT(CASE WHEN k.out_bandwidth_usage_pct > 90 THEN 1 END) AS overload
FROM t_interface_perf_kpi k
JOIN t_interface i ON k.if_id = i.if_id
JOIN t_network_element ne ON k.ne_id = ne.ne_id
CROSS JOIN latest l
WHERE k.collect_time = l.t AND ne.role = 'PE' AND i.if_type = 'PHYSICAL'
GROUP BY ne.ne_name
ORDER BY overload DESC;
```

---

### Q10 [Hard] 窗口函数 + 趋势

**问题**：查看过去7天华北区域PE设备的每日平均CPU利用率趋势及环比变化。

**隐含知识**："华北区域"可能对应region='华北'

```sql
WITH daily AS (
  SELECT DATE(k.collect_time) AS day, AVG(k.cpu_usage_avg_pct) AS avg_cpu
  FROM t_ne_perf_kpi k
  JOIN t_network_element ne ON k.ne_id = ne.ne_id
  JOIN t_site s ON ne.site_id = s.site_id
  WHERE s.region = '华北' AND ne.role = 'PE'
    AND k.collect_time >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY DATE(k.collect_time)
)
SELECT day, ROUND(avg_cpu, 2) AS avg_cpu,
       ROUND(avg_cpu - LAG(avg_cpu) OVER (ORDER BY day), 2) AS change
FROM daily ORDER BY day;
```

---

### Q11 [Extra Hard] SLA违规率排名

**问题**：找出SLA违规率最高的前5个VPN客户，统计每个客户的VPN数量、总违规次数和违规率（最近30天）。

```sql
WITH stats AS (
  SELECT v.customer_id, v.customer_name,
    COUNT(DISTINCT v.vpn_id) AS vpn_count,
    COUNT(sk.kpi_id) AS total_samples,
    SUM(CASE WHEN sk.sla_overall_met = FALSE THEN 1 ELSE 0 END) AS violations
  FROM t_l3vpn_service v
  JOIN t_vpn_sla_kpi sk ON v.vpn_id = sk.vpn_id
  WHERE sk.collect_time >= CURRENT_DATE - INTERVAL '30 days'
    AND v.admin_status = 'ACTIVE'
  GROUP BY v.customer_id, v.customer_name
)
SELECT customer_name, vpn_count, violations, total_samples,
  ROUND(violations * 100.0 / NULLIF(total_samples, 0), 2) AS violation_rate_pct
FROM stats WHERE total_samples > 0
ORDER BY violation_rate_pct DESC LIMIT 5;
```

---

### Q12 [Extra Hard] 单点故障链路检测

**问题**：找出所有"单点故障"链路——两个站点之间只有一条物理链路、且该链路承载了GOLD级别VPN业务。

**隐含知识**："单点故障"需推断为"站点间链路数=1"；链路→NE→VPN的间接关联

```sql
WITH site_pair AS (
  SELECT LEAST(a_site_id, z_site_id) AS s1,
         GREATEST(a_site_id, z_site_id) AS s2,
         COUNT(*) AS link_cnt, ARRAY_AGG(link_id) AS links
  FROM t_physical_link WHERE oper_status = 'UP'
  GROUP BY LEAST(a_site_id, z_site_id), GREATEST(a_site_id, z_site_id)
  HAVING COUNT(*) = 1
),
gold_links AS (
  SELECT DISTINCT pl.link_id
  FROM t_physical_link pl
  JOIN t_vpn_pe_binding b ON b.ne_id = pl.a_ne_id
  JOIN t_l3vpn_service v ON b.vpn_id = v.vpn_id
  WHERE v.service_level IN ('GOLD','PLATINUM') AND v.admin_status = 'ACTIVE'
)
SELECT pl.link_name, sa.site_name AS site_a, sz.site_name AS site_b,
       pl.bandwidth_mbps, pl.distance_km
FROM site_pair sp
JOIN t_physical_link pl ON pl.link_id = ANY(sp.links)
JOIN t_site sa ON sp.s1 = sa.site_id
JOIN t_site sz ON sp.s2 = sz.site_id
WHERE pl.link_id IN (SELECT link_id FROM gold_links);
```

**诊断价值**：这道题对NL2SQL极具挑战性——"单点故障"是纯业务概念，需要模型推断出"站点间链路数=1"的数学含义。

---

### Q13 [Medium] NOT EXISTS反向逻辑

**问题**：哪些PE已经使能了SRv6但还没有创建任何SRv6 Policy？

```sql
SELECT ne.ne_name, ne.model, ne.srv6_locator
FROM t_network_element ne
WHERE ne.srv6_enabled = TRUE AND ne.role = 'PE'
  AND NOT EXISTS (SELECT 1 FROM t_srv6_policy sp WHERE sp.source_ne_id = ne.ne_id);
```

---

### Q14 [Hard] 时间窗口对比

**问题**：对比上周和本周各站点平均接口带宽利用率，找出增长超过20个百分点的站点。

```sql
WITH weekly AS (
  SELECT s.site_id, s.site_name,
    CASE WHEN k.collect_time >= CURRENT_DATE - 7 THEN 'THIS' ELSE 'LAST' END AS wk,
    AVG(k.out_bandwidth_usage_pct) AS avg_bw
  FROM t_interface_perf_kpi k
  JOIN t_network_element ne ON k.ne_id = ne.ne_id
  JOIN t_site s ON ne.site_id = s.site_id
  WHERE k.collect_time >= CURRENT_DATE - 14
  GROUP BY s.site_id, s.site_name,
    CASE WHEN k.collect_time >= CURRENT_DATE - 7 THEN 'THIS' ELSE 'LAST' END
)
SELECT tw.site_name,
  ROUND(lw.avg_bw, 2) AS last_week, ROUND(tw.avg_bw, 2) AS this_week,
  ROUND(tw.avg_bw - lw.avg_bw, 2) AS increase
FROM weekly tw JOIN weekly lw ON tw.site_id = lw.site_id
WHERE tw.wk = 'THIS' AND lw.wk = 'LAST' AND (tw.avg_bw - lw.avg_bw) > 20
ORDER BY increase DESC;
```

---

### Q15 [Extra Hard] 综合健康评分

**问题**：为每条GOLD级VPN业务计算健康评分（时延达标+25分，抖动达标+25分，丢包达标+25分，可用率达标+25分），输出评分低于75分的业务。

```sql
WITH health AS (
  SELECT v.vpn_id, v.vpn_name, v.customer_name,
    AVG(CASE WHEN sk.sla_latency_met THEN 25 ELSE 0 END) +
    AVG(CASE WHEN sk.sla_jitter_met THEN 25 ELSE 0 END) +
    AVG(CASE WHEN sk.sla_loss_met THEN 25 ELSE 0 END) +
    AVG(CASE WHEN sk.sla_availability_met THEN 25 ELSE 0 END) AS score,
    AVG(sk.e2e_latency_avg_ms) AS lat, AVG(sk.e2e_packet_loss_pct) AS loss,
    AVG(sk.availability_pct) AS avail
  FROM t_l3vpn_service v
  JOIN t_vpn_sla_kpi sk ON v.vpn_id = sk.vpn_id
  WHERE v.service_level = 'GOLD' AND v.admin_status = 'ACTIVE'
    AND sk.collect_time >= CURRENT_DATE - 7
  GROUP BY v.vpn_id, v.vpn_name, v.customer_name
)
SELECT vpn_name, customer_name, ROUND(score, 1) AS health_score,
  ROUND(lat, 2) AS avg_latency_ms, ROUND(loss, 4) AS avg_loss_pct,
  ROUND(avail, 2) AS availability_pct
FROM health WHERE score < 75 ORDER BY score;
```

---

## 四、测试策略

### 4.1 分层测试矩阵

| 层级 | 测试目标 | 样例数建议 | 核心指标 |
|------|---------|-----------|---------|
| L1 Schema理解 | 表/列映射准确性 | 20-30 | 表选择准确率、列匹配率 |
| L2 单表查询 | 过滤、聚合、排序 | 30-50 | SQL执行正确率 |
| L3 多表JOIN | 2-3表关联 | 30-50 | FK推断正确率 |
| L4 复杂分析 | CTE/窗口函数/嵌套 | 20-30 | 语义→SQL映射正确率 |
| L5 业务推理 | 隐含条件推断 | 10-20 | 领域知识融入能力 |

### 4.2 WrenAI专项测试

**MDL语义层增益测试**（最关键）：
- 同一批15道题，先跑一轮纯DDL无MDL，再跑一轮完整MDL配置（Relationship + Calculated Field + Column Description）
- 两轮准确率差值 = 语义层的实际增益
- 重点观察：Q06(三表JOIN路径)、Q08(软关联)、Q12(业务语义推断) 在有/无MDL下的表现差异

**RAG检索质量测试**：
- 同义词："设备"应命中t_network_element而非t_board
- 缩略语：SRv6、L3VPN、PE、iFIT能否正确理解
- 歧义："性能"在不同上下文下应命中不同KPI表

**鲁棒性测试**：
- 同一问题5种不同中文表述，测结果一致性
- 例如Q01的变体："列出华为的PE路由器"/"查所有华为边缘设备"/"HUAWEI的PE有哪些"

### 4.3 对比测试建议

| 维度 | 方案A | 方案B | 对比目标 |
|------|------|------|---------|
| 语义层 | 无MDL | 有MDL | 量化MDL增益 |
| 示例 | 无Few-shot | 有Few-shot | 量化示例增益 |
| LLM | GPT-4o | Claude Sonnet | 模型能力对比 |
| 问法 | 标准表述 | 5种变体 | 鲁棒性评估 |

### 4.4 模拟数据规模建议

| 表 | 行数 | 分布要点 |
|----|------|---------|
| t_site | 25 | 5大区×5城市 |
| t_network_element | 150 | PE:P:CE≈4:2:4, HUAWEI/CISCO各半 |
| t_board | 600 | 每设备3-5块 |
| t_interface | 4000 | 每设备20-30口, 混合物理/逻辑 |
| t_physical_link | 300 | 含站间/站内, 不同带宽等级 |
| t_vrf_instance | 400 | 每PE 3-5个VRF |
| t_l3vpn_service | 80 | GOLD:SILVER:BRONZE≈2:5:3 |
| t_vpn_pe_binding | 300 | 每VPN关联2-5台PE |
| t_srv6_policy | 150 | STATIC/DYNAMIC/CONTROLLER各1/3 |
| t_tunnel | 300 | SRv6 BE/TE + MPLS多类型 |
| t_ne_perf_kpi | 100K+ | 7天×96点×150台 |
| t_interface_perf_kpi | 200K+ | 采样部分接口 |
| t_tunnel_perf_kpi | 60K+ | 7天×96点×隧道 |
| t_vpn_sla_kpi | 40K+ | 7天×96点×VPN |

**关键**：确保5-10%的数据是"异常"的（DOWN状态、SLA违规、高利用率），否则查询无结果。

---

## 五、开源方案对比建议

| 项目 | GitHub Stars | 核心差异 | 建议优先级 |
|------|-------------|---------|-----------|
| **WrenAI** | ~14.6K | MDL语义层, 与你们KT2思路高度吻合 | 深入研究 |
| **Vanna 2.0** | ~23K | Agent架构, RAG驱动, 无语义层 | 浅层对比 |
| **DB-GPT** | ~14K+ | AWEL工作流, 多Agent | 架构参考 |

**务实建议**：一人年scope下，深入WrenAI一个，用同一套Schema浅跑Vanna做对比。两者的失败case往往揭示NL2SQL的共性难题——这些才是自研系统真正要攻克的。

---

## 六、配套CSV字段字典说明

配套文件 `nms_field_dictionary_full.csv` 为14张表的全量列级字典（356行数据行 + 1行表头），可直接用于WrenAI MDL建模和Semantic Forge知识治理。

**CSV列定义**：

| CSV列 | 用途 | 使用场景 |
|-------|------|---------|
| `table` | 表名 | Schema对齐 |
| `column` | 列名 | Schema对齐 |
| `english_term` | 英文业务术语 | MDL Column Description |
| `chinese_desc` | 中文业务语义描述（LLM可直接理解） | MDL Column Description / RAG检索素材 |
| `data_type` | 数据类型 | Schema对齐 |
| `nullable` | 是否可空 | 数据生成约束 |
| `default` | 默认值 | 数据生成约束 |
| `example_values` | 示例值（分号分隔） | MDL示例 / Few-shot构造 |
| `domain` | 值域/约束说明 | MDL枚举定义 |
| `foreign_key` | 外键目标（格式: 表名.列名，无则-） | MDL Relationship定义 |
| `source_ref` | 来源依据（RFC/标准/厂商，无则-） | 知识溯源（不注入LLM） |

**外键覆盖统计**（26个FK引用）：

| 被引用表.列 | 引用次数 | 说明 |
|------------|---------|------|
| t_network_element.ne_id | 16 | 几乎所有表都关联网元 |
| t_interface.if_id | 4 | 链路、KPI等关联接口 |
| t_site.site_id | 3 | 网元、链路关联站点 |
| t_l3vpn_service.vpn_id | 2 | 绑定表、SLA KPI关联VPN |
| t_srv6_policy.policy_id | 1 | 隧道关联Policy |
| t_tunnel.tunnel_id | 1 | 隧道KPI关联隧道 |
| t_board.board_id | 1 | 接口关联单板 |
| t_vrf_instance.vrf_id | 1 | 绑定表关联VRF |

**使用方式**：

```python
# 批量导入WrenAI MDL的Column Description
import csv
with open('nms_field_dictionary_full.csv') as f:
    for row in csv.DictReader(f):
        # chinese_desc → MDL Column Description
        # foreign_key → MDL Relationship
        # example_values → MDL示例值
        # source_ref → 内部知识库溯源（不注入MDL）
        pass
```
