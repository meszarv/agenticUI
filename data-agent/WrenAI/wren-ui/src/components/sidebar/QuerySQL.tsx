import styled from 'styled-components';
import ConsoleSqlOutlined from '@ant-design/icons/ConsoleSqlOutlined';
import { MENU_KEY } from '@/utils/enum';
import SidebarMenu from '@/components/sidebar/SidebarMenu';

const Layout = styled.div`
  padding: 16px 0;
  position: absolute;
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  background-color: var(--gray-2);
  overflow: hidden;
`;

export default function QuerySQL() {
  const menuItems = [
    {
      label: 'SQL Query',
      icon: <ConsoleSqlOutlined />,
      key: MENU_KEY.SQL_QUERY,
      className: 'pl-4',
    },
  ];

  return (
    <Layout>
      <SidebarMenu items={menuItems} selectedKeys={[MENU_KEY.SQL_QUERY]} />
    </Layout>
  );
}
