/**
 * Nội dung hướng dẫn sử dụng Tenant Admin.
 *
 * Typed data rather than one long JSX block, so the page stays readable
 * and the tests can check coverage structurally: every navigation
 * destination must have a section, and every `route` must be real.
 *
 * Accuracy rule for anyone editing this file: describe only what the
 * application currently does. A limitation belongs in `limits` of the
 * relevant section — never omitted to make the guide read more smoothly.
 */

export type HelpSection = {
  /** Anchor id. Stable: the table of contents links to it. */
  id: string;
  title: string;
  /** The real route this section documents, or null if reached in-page. */
  route: string | null;
  /** Shown when the section is not a standalone route. */
  routeNote?: string;
  purpose: string;
  canDo: string[];
  workflow: string[];
  concepts: { term: string; meaning: string }[];
  limits: string[];
};

export const QUICK_START: string[] = [
  'Kiểm tra trang Tổng quan để biết hôm nay có gì cần xử lý.',
  'Vào Đơn hàng để xem đơn mới và cập nhật trạng thái khi đã giao xong.',
  'Vào Chuẩn bị giao để biết đơn nào đã sẵn sàng đóng gói, đơn nào còn vướng.',
  'In Phiếu đóng gói và Ghi chú vận chuyển từ từng đơn trước khi gửi hàng.',
  'Trước khi bán, hãy bật ít nhất một phương thức thanh toán và một phương thức vận chuyển.',
];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'tong-quan',
    title: 'Tổng quan',
    route: '/tenant-admin',
    purpose:
      'Trang mở đầu, cho biết nhanh tình hình cửa hàng: bao nhiêu đơn đang chờ, giá trị đơn trong 30 ngày gần nhất, số sản phẩm đang bán và số mẫu mã sắp hết hàng.',
    canDo: [
      'Xem nhanh các con số quan trọng của cửa hàng.',
      'Bấm vào từng ô số để đi thẳng tới danh sách tương ứng.',
      'Dùng lối tắt để thêm sản phẩm, xem đơn, cấu hình vận chuyển hoặc thanh toán.',
    ],
    workflow: [
      'Mở Tổng quan mỗi sáng.',
      'Nếu ô “Đơn chờ xử lý” lớn hơn 0, bấm vào đó để xử lý đơn trước.',
      'Nếu ô “Sắp hết hàng” lớn hơn 0, bấm vào đó để nhập thêm hàng.',
    ],
    concepts: [
      {
        term: 'Giá trị đơn hàng (30 ngày)',
        meaning:
          'Tổng tiền hàng cộng phí vận chuyển của các đơn chưa bị huỷ. Đây là giá trị đơn hàng, không phải doanh thu đã thu: trong đó có cả đơn khách chưa trả tiền.',
      },
      {
        term: 'Cần chú ý',
        meaning:
          'Dòng chữ xuất hiện dưới một con số khi mục đó cần bạn xử lý. Luôn có chữ đi kèm, không chỉ dựa vào màu sắc.',
      },
    ],
    limits: [
      'Các con số chỉ để đọc, trang này không thay đổi dữ liệu gì.',
      'Hệ thống không theo dõi tài khoản ngân hàng của bạn, nên không con số nào ở đây là “tiền đã về tài khoản”.',
    ],
  },
  {
    id: 'don-hang',
    title: 'Đơn hàng',
    route: '/tenant-admin/orders',
    purpose: 'Danh sách toàn bộ đơn của cửa hàng, nơi bạn theo dõi và cập nhật trạng thái đơn.',
    canDo: [
      'Tìm đơn theo mã đơn, tên hoặc số điện thoại khách.',
      'Lọc theo trạng thái đơn.',
      'Mở từng đơn để xem sản phẩm, địa chỉ giao và lịch sử thay đổi.',
      'Cập nhật trạng thái đơn, kể cả nhiều đơn cùng lúc.',
      'Xác nhận đã nhận tiền với đơn chuyển khoản thủ công.',
      'Xuất danh sách đơn ra file CSV.',
      'In chứng từ cho từng đơn.',
    ],
    workflow: [
      'Mở đơn mới để kiểm tra sản phẩm và địa chỉ giao.',
      'Nếu khách chuyển khoản thủ công, đối chiếu với ngân hàng rồi bấm xác nhận đã nhận tiền.',
      'In Phiếu đóng gói và soạn hàng theo phiếu.',
      'Khi đã gửi hàng xong, đổi trạng thái đơn sang đã hoàn tất.',
    ],
    concepts: [
      {
        term: 'Trạng thái đơn',
        meaning: 'Hệ thống chỉ có ba trạng thái: đang chờ, đã hoàn tất và đã huỷ.',
      },
      {
        term: 'Trạng thái thanh toán',
        meaning:
          'Hiển thị riêng, không gộp với trạng thái đơn. Một đơn có thể đã hoàn tất nhưng thanh toán vẫn đang chờ, ví dụ đơn COD.',
      },
      {
        term: 'Thông tin vận chuyển đã lưu',
        meaning:
          'Địa chỉ, phí ship và tên phương thức vận chuyển được lưu lại tại thời điểm đặt hàng. Sau này bạn đổi cấu hình thì đơn cũ vẫn giữ thông tin cũ.',
      },
    ],
    limits: [
      'Đơn ở trạng thái đã hoàn tất chỉ có nghĩa là bạn đã đánh dấu hoàn tất trong hệ thống. Nó không chứng minh đơn vị vận chuyển đã lấy hàng, đã giao tới khách, hay đã thu hộ tiền COD.',
      'Hệ thống không có mã vận đơn và không kết nối với bất kỳ đơn vị vận chuyển nào.',
      'File CSV xuất ra có chứa thông tin cá nhân của khách, hãy lưu giữ cẩn thận.',
    ],
  },
  {
    id: 'in-chung-tu',
    title: 'In chứng từ đơn hàng',
    route: null,
    routeNote: 'Mở một đơn ở trang Đơn hàng, phần “Print” có ba lựa chọn in.',
    purpose:
      'In ba loại giấy tờ phục vụ đóng gói và giao hàng. In bằng trình duyệt, hoặc chọn “Save as PDF” trong hộp thoại in.',
    canDo: [
      'In Tóm tắt đơn hàng: có giá, tổng tiền và trạng thái.',
      'In Phiếu đóng gói: chỉ có sản phẩm và số lượng, kèm ô tích khi đóng gói.',
      'In Ghi chú vận chuyển: người nhận, địa chỉ và số tiền cần thu khi giao nếu là đơn COD.',
    ],
    workflow: [
      'Mở đơn cần xử lý.',
      'In Phiếu đóng gói cho người soạn hàng.',
      'In Ghi chú vận chuyển để kẹp theo kiện hàng khi bàn giao.',
      'In Tóm tắt đơn hàng nếu khách cần giấy xác nhận.',
    ],
    concepts: [
      {
        term: 'Phiếu đóng gói',
        meaning:
          'Cố tình không in giá. Người soạn hàng không cần biết giá, và phiếu này thường nằm trong kiện hàng.',
      },
      {
        term: 'Số tiền thu khi giao',
        meaning: 'Chỉ hiện với đơn COD. Đơn đã thanh toán trước sẽ ghi rõ là không cần thu thêm.',
      },
    ],
    limits: [
      'Đây không phải hoá đơn VAT và không phải hoá đơn điện tử.',
      'Ghi chú vận chuyển không phải vận đơn chính thức của đơn vị vận chuyển: không có mã vận đơn, không có mã vạch, không có tên hãng vận chuyển.',
      'Mở hoặc in chứng từ không làm thay đổi đơn hàng.',
      'Bản in căn theo khổ A4. Khổ A5 và máy in nhiệt vẫn in được nhưng chỉ là thu nhỏ theo trình duyệt, chưa được tinh chỉnh riêng.',
    ],
  },
  {
    id: 'chuan-bi-giao',
    title: 'Chuẩn bị giao hàng',
    route: '/tenant-admin/fulfillment',
    purpose:
      'Hàng chờ nội bộ, giúp bạn biết đơn nào đã sẵn sàng đóng gói và đơn nào còn vướng mắc.',
    canDo: [
      'Xem số lượng đơn theo từng nhóm.',
      'Lọc theo nhóm, tìm theo mã đơn, tên hoặc số điện thoại khách.',
      'Đọc lý do cụ thể khiến một đơn chưa thể chuẩn bị.',
      'Mở đơn hoặc in phiếu ngay từ danh sách.',
    ],
    workflow: [
      'Lọc nhóm Cần xem lại để xử lý các đơn đang vướng trước.',
      'Lọc nhóm Sẵn sàng chuẩn bị để soạn hàng.',
      'In phiếu, gửi hàng, rồi cập nhật trạng thái đơn ở trang Đơn hàng.',
    ],
    concepts: [
      {
        term: 'Sẵn sàng chuẩn bị',
        meaning:
          'Đơn chưa huỷ, chưa hoàn tất, đã có phương thức vận chuyển, và hoặc là đơn COD hoặc đã thanh toán thành công.',
      },
      { term: 'Chờ thanh toán', meaning: 'Đơn trả trước nhưng thanh toán chưa thành công.' },
      {
        term: 'Cần xem lại',
        meaning:
          'Đơn có vướng mắc cụ thể: chưa lưu phương thức vận chuyển, hoặc thanh toán đã thất bại, hết hạn hay bị huỷ. Lý do luôn ghi bằng chữ.',
      },
      {
        term: 'Đơn COD',
        meaning:
          'Thanh toán của đơn COD luôn ở trạng thái đang chờ, vì tiền mặt thu khi giao và hệ thống không ghi nhận việc đó. Vì vậy đơn COD vẫn được xem là sẵn sàng chuẩn bị.',
      },
    ],
    limits: [
      'Đây là hàng chờ nội bộ, không phải hệ thống vận chuyển. Không có mã vận đơn, không kết nối hãng vận chuyển.',
      'Trang này không cho biết đơn đã được lấy hàng, đã giao, giao thất bại, bị trả lại, đã hoàn tiền hay đã thu hộ COD.',
      'Tồn kho không tính là vướng mắc: hàng đã được giữ sẵn ngay khi khách đặt đơn.',
      'Danh sách sắp theo đơn mới nhất, không tự đẩy đơn vướng mắc lên đầu. Hãy dùng bộ lọc.',
    ],
  },
  {
    id: 'khach-hang',
    title: 'Khách hàng',
    route: '/tenant-admin/customers',
    purpose:
      'Danh sách những người đã từng mua hàng, tổng hợp từ lịch sử đơn hàng của chính cửa hàng bạn.',
    canDo: [
      'Tìm khách theo tên, số điện thoại hoặc email.',
      'Sắp xếp theo khách mới nhất, lần mua gần nhất, số đơn hoặc giá trị đơn.',
      'Mở từng khách để xem toàn bộ lịch sử mua.',
      'Xuất danh sách khách ra file CSV.',
    ],
    workflow: [
      'Tìm khách theo số điện thoại khi khách gọi tới hỏi đơn.',
      'Mở trang khách để xem các đơn cũ và tình trạng từng đơn.',
      'Bấm mở đơn cụ thể nếu cần xử lý tiếp.',
    ],
    concepts: [
      { term: 'Số đơn', meaning: 'Đếm tất cả đơn khách đã đặt, bao gồm cả đơn đã huỷ.' },
      {
        term: 'Giá trị đơn',
        meaning:
          'Tiền hàng cộng phí vận chuyển của các đơn chưa huỷ. Có tính cả đơn khách chưa trả tiền. Đây không phải doanh thu đã thu.',
      },
      {
        term: 'Trùng số điện thoại',
        meaning:
          'Hai khách khác email nhưng cùng số điện thoại sẽ hiện thành hai dòng riêng kèm ghi chú. Hệ thống không tự gộp.',
      },
    ],
    limits: [
      'Không sửa, xoá hay gộp khách hàng được trong phiên bản này.',
      'Hệ thống nhận diện khách theo email. Khách dùng email khác sẽ được tính là người khác.',
      'Không có thông tin về đồng ý nhận quảng cáo, hạng thành viên, tỉ lệ trả hàng hay việc đã thu tiền COD.',
      'File CSV tối đa 5000 khách và có chứa thông tin cá nhân.',
    ],
  },
  {
    id: 'san-pham',
    title: 'Sản phẩm',
    route: '/tenant-admin/catalog',
    purpose: 'Nơi quản lý toàn bộ sản phẩm: thông tin, giá, mẫu mã, tồn kho, giảm giá và hình ảnh.',
    canDo: [
      'Sửa tên, mô tả, giá và trạng thái hiển thị của sản phẩm.',
      'Tạo thuộc tính như Màu hoặc Kích cỡ, rồi sinh mẫu mã từ các thuộc tính đó.',
      'Sửa giá và mã SKU của từng mẫu mã.',
      'Điều chỉnh tồn kho.',
      'Đặt hoặc gỡ giảm giá cho sản phẩm.',
      'Tải ảnh và video sản phẩm.',
    ],
    workflow: [
      'Mở sản phẩm cần sửa.',
      'Sửa thông tin chung rồi bấm Save product.',
      'Nếu sản phẩm có nhiều mẫu mã, sửa từng dòng rồi bấm Save variant của dòng đó.',
      'Dùng ô Adjust để tăng giảm tồn kho.',
    ],
    concepts: [
      {
        term: 'Mỗi nút lưu một phạm vi riêng',
        meaning:
          'Save product lưu thông tin chung. Save variant lưu một mẫu mã. Adjust chỉnh tồn kho. Đây là các thao tác độc lập, không lưu thay cho nhau.',
      },
      {
        term: 'Nháp và đang bán',
        meaning:
          'Sản phẩm ở trạng thái nháp không hiện ngoài cửa hàng. Chuyển sang đang bán thì khách mới thấy.',
      },
      {
        term: 'Ảnh được chuyển sang WebP',
        meaning:
          'Ảnh JPG và PNG tải lên được chuyển sang WebP cho nhẹ hơn. Ảnh động không được hỗ trợ.',
      },
    ],
    limits: [
      'Chỉ ảnh tải lên mới được chuyển sang WebP. Ảnh cũ đã có từ trước vẫn giữ nguyên định dạng.',
      'Điều chỉnh tồn kho không thể làm số hàng còn lại thấp hơn số hàng đang giữ cho các đơn chưa giao.',
      'Xoá một giá trị thuộc tính sẽ xoá luôn các mẫu mã được tạo từ giá trị đó.',
    ],
  },
  {
    id: 'them-san-pham',
    title: 'Thêm sản phẩm',
    route: '/tenant-admin/products/new',
    purpose: 'Tạo nhanh một sản phẩm mới với tên và giá.',
    canDo: ['Nhập tên, giá và trạng thái để tạo sản phẩm.'],
    workflow: [
      'Bấm Add a product ở trang Sản phẩm.',
      'Nhập tên và giá rồi tạo.',
      'Quay lại trang Sản phẩm để thêm ảnh, mẫu mã, tồn kho và giảm giá.',
    ],
    concepts: [
      {
        term: 'Sản phẩm đơn giản',
        meaning:
          'Sản phẩm mới tạo chỉ có một mẫu mã duy nhất. Muốn nhiều mẫu mã thì thêm thuộc tính ở trang Sản phẩm.',
      },
    ],
    limits: [
      'Trang này chỉ tạo phần thông tin cơ bản. Ảnh, mẫu mã, tồn kho và giảm giá làm ở trang Sản phẩm sau khi tạo xong.',
    ],
  },
  {
    id: 'nhap-xuat-csv',
    title: 'Nhập và xuất sản phẩm bằng file CSV',
    route: '/tenant-admin/catalog',
    routeNote: 'Nằm trong mục “CSV import and export” ở trang Sản phẩm.',
    purpose:
      'Thêm hoặc cập nhật nhiều sản phẩm cùng lúc bằng file CSV, và tải danh sách sản phẩm hiện có ra file.',
    canDo: [
      'Xem trước kết quả trước khi nhập thật.',
      'Nhập file dạng đơn giản chỉ gồm tên và giá.',
      'Nhập file dạng mở rộng có SKU để cập nhật sản phẩm đã có.',
      'Đặt tồn kho theo số tuyệt đối hoặc tăng giảm tương đối.',
      'Xuất danh sách sản phẩm hiện tại.',
    ],
    workflow: [
      'Chọn file rồi bấm Preview import. Bước này chỉ kiểm tra, chưa ghi gì vào hệ thống.',
      'Đọc kỹ bảng kết quả: dòng nào tạo mới, dòng nào cập nhật, dòng nào lỗi.',
      'Nếu mọi thứ đúng, bấm nút xác nhận để nhập thật.',
      'Nếu có dòng lỗi, sửa file rồi xem trước lại.',
    ],
    concepts: [
      {
        term: 'Hai dạng file',
        meaning:
          'Dạng đơn giản gồm đúng các cột name,price và có thể thêm status, chỉ dùng để tạo mới. Dạng mở rộng dùng tên cột và bắt buộc có sku, name, price.',
      },
      {
        term: 'SKU là khoá đối chiếu',
        meaning:
          'Hệ thống dựa vào SKU để biết dòng đó là sản phẩm đã có hay sản phẩm mới. SKU đã tồn tại thì cập nhật, SKU mới thì tạo mới.',
      },
      {
        term: 'Nhập lại cùng một file',
        meaning: 'An toàn. Lần nhập thứ hai sẽ báo không có gì thay đổi, không tạo trùng sản phẩm.',
      },
      {
        term: 'Chế độ tồn kho',
        meaning:
          'set_on_hand là đặt về đúng con số bạn ghi. adjust_on_hand là cộng hoặc trừ đi. Bắt buộc ghi rõ, hệ thống không tự đoán.',
      },
    ],
    limits: [
      'Toàn bộ file được nhập trong một lần duy nhất: nếu có một dòng lỗi thì không dòng nào được ghi vào hệ thống.',
      'Dòng sai hoặc trùng SKU sẽ chặn cả lần nhập, hệ thống không tự bỏ qua dòng sai.',
      'Mỗi file tối đa 1 MB và 500 dòng.',
      'Không nhập được giảm giá, hình ảnh, thuộc tính hay mẫu mã qua CSV. Các cột đó sẽ bị báo lỗi kèm lý do.',
      'Sản phẩm cũ chưa có SKU thì không cập nhật được bằng CSV. Hãy đặt SKU cho sản phẩm đó trước.',
      'File xuất ra là bản báo cáo để đọc, không dùng để nhập ngược trở lại.',
    ],
  },
  {
    id: 'phan-tich',
    title: 'Phân tích vận hành',
    route: '/tenant-admin/analytics',
    purpose:
      'Đếm chính xác những gì cửa hàng đã ghi nhận: đơn hàng, thanh toán, khách hàng và tồn kho. Mọi con số đều được định nghĩa ngay trên trang.',
    canDo: [
      'Chọn khoảng ngày để xem số đơn và giá trị đơn trong khoảng đó.',
      'Xem số đơn theo từng trạng thái: chờ xử lý, đã xử lý, đã huỷ.',
      'Xem số thanh toán theo từng trạng thái.',
      'Xem số lần hệ thống từ chối thông báo thanh toán, theo lý do.',
      'Xem tổng số khách, số khách đã từng mua và số khách mua từ hai đơn trở lên.',
      'Xem số sản phẩm, số mẫu mã hết hàng và sắp hết hàng.',
    ],
    workflow: [
      'Mặc định trang hiển thị 30 ngày gần nhất.',
      'Đổi ngày bắt đầu và ngày kết thúc rồi bấm Áp dụng.',
      'Bấm Đặt lại để quay về 30 ngày gần nhất.',
    ],
    concepts: [
      {
        term: 'Giá trị đơn',
        meaning:
          'Tiền hàng cộng phí vận chuyển của các đơn chưa huỷ, tính cả đơn khách chưa trả tiền. Đây KHÔNG phải doanh thu đã thu được.',
      },
      {
        term: 'Thanh toán thành công',
        meaning:
          'Hệ thống đã nhận và kiểm tra xác nhận từ nhà cung cấp, số tiền báo về khớp với đơn. Điều này không chứng minh tiền đã về tài khoản ngân hàng.',
      },
      {
        term: 'COD đang chờ',
        meaning:
          'Là bình thường, không phải lỗi. Tiền mặt được thu qua người giao hàng và hệ thống không bao giờ biết kết quả, nên đơn COD luôn ở trạng thái chờ.',
      },
      {
        term: 'Thông báo thanh toán bị từ chối',
        meaning:
          'Đếm số trường hợp từ chối khác nhau được ghi nhận lần đầu trong khoảng ngày, mỗi trường hợp tính một lần dù nhà cung cấp gửi lại nhiều lần. Đây là bằng chứng, không phải đã đối soát hay đã xử lý xong.',
      },
      {
        term: 'Mốc ngày',
        meaning:
          'Tính theo giờ Việt Nam (UTC+7), cố định cho mọi cửa hàng. Cả ngày bắt đầu và ngày kết thúc đều được tính vào. Một khoảng tối đa 366 ngày.',
      },
      {
        term: 'Có thể bán',
        meaning: 'Số tồn kho thực tế trừ đi số đã giữ cho các đơn đã đặt nhưng chưa xử lý xong.',
      },
    ],
    limits: [
      'Trang này chỉ xem, không sửa được gì.',
      'Số sản phẩm, tồn kho và tổng số khách là số liệu hiện tại, không theo khoảng ngày.',
      'Không có doanh thu đã thu, tiền đã về ngân hàng, hay việc đã thu tiền COD.',
      'Không có thông tin giao hàng, đơn vị vận chuyển, phí vận chuyển thực tế hay tình trạng giao.',
      'Không có trả hàng, hoàn tiền, lợi nhuận, biên lợi nhuận, thuế hay VAT.',
      'Không có nguồn khách, tỉ lệ chuyển đổi hay thông tin đồng ý nhận quảng cáo.',
      'Đây không phải chứng từ kế toán, thuế hay ngân hàng.',
    ],
  },
  {
    id: 'thuong-hieu',
    title: 'Thương hiệu',
    route: '/tenant-admin/branding',
    purpose: 'Đặt tên cửa hàng, logo, favicon và bộ màu hiển thị ngoài cửa hàng.',
    canDo: [
      'Đổi tên cửa hàng.',
      'Tải logo lên hoặc dán đường dẫn ảnh.',
      'Tải favicon, là biểu tượng nhỏ hiện trên tab trình duyệt.',
      'Tải file cấu hình màu sắc và kiểu chữ.',
    ],
    workflow: [
      'Nhập tên cửa hàng rồi lưu.',
      'Tải logo và favicon.',
      'Mở cửa hàng ở tab mới để xem kết quả.',
    ],
    concepts: [
      {
        term: 'Logo dạng SVG',
        meaning:
          'Logo SVG được giữ nguyên dạng SVG, không bị chuyển sang ảnh thường. Logo dạng JPG hoặc PNG thì được chuyển sang WebP.',
      },
      {
        term: 'Favicon',
        meaning:
          'Giữ nguyên định dạng bạn tải lên, không chuyển sang WebP, để trình duyệt nào cũng hiển thị được.',
      },
    ],
    limits: [
      'File cấu hình màu sắc là file chữ dạng Markdown, không phải ảnh.',
      'Thay đổi thương hiệu chỉ ảnh hưởng tới giao diện, không ảnh hưởng tới đơn hàng hay thanh toán.',
    ],
  },
  {
    id: 'banner',
    title: 'Banner cửa hàng',
    route: '/tenant-admin/banners',
    purpose: 'Quản lý dải ảnh lớn hiển thị ở đầu trang cửa hàng.',
    canDo: [
      'Thêm banner mới với ảnh cho máy tính và ảnh riêng cho điện thoại.',
      'Thêm nút bấm dẫn tới một trang sản phẩm.',
      'Bật hoặc tắt từng banner, đổi thứ tự hiển thị.',
      'Xoá banner.',
    ],
    workflow: [
      'Bấm Add a banner, tải ảnh lên và cắt theo tỉ lệ gợi ý.',
      'Đặt thứ tự hiển thị rồi bật banner.',
      'Mở cửa hàng để kiểm tra.',
    ],
    concepts: [
      {
        term: 'Ảnh máy tính và ảnh điện thoại',
        meaning:
          'Ảnh máy tính cắt theo tỉ lệ 21:9. Ảnh điện thoại cắt theo 4:3. Nếu không đặt ảnh điện thoại thì hệ thống dùng ảnh máy tính.',
      },
      {
        term: 'Thứ tự hiển thị',
        meaning: 'Số nhỏ hiện trước. Chỉ banner đang bật mới hiển thị.',
      },
    ],
    limits: [
      'Ảnh là toàn bộ nội dung banner, hệ thống không chèn chữ lên ảnh.',
      'Nếu chưa có banner nào, cửa hàng hiển thị banner chào mặc định.',
      'Xoá banner không khôi phục được, ảnh cũng bị xoá khỏi kho lưu trữ.',
    ],
  },
  {
    id: 'thanh-toan',
    title: 'Phương thức thanh toán',
    route: '/tenant-admin/payments',
    purpose: 'Bật, tắt và cấu hình các cách khách có thể trả tiền.',
    canDo: [
      'Bật hoặc tắt thanh toán khi nhận hàng (COD).',
      'Bật chuyển khoản ngân hàng và chọn cách xử lý: thủ công hoặc SePay.',
      'Nhập thông tin tài khoản ngân hàng cho hình thức thủ công.',
      'Bật hoặc tắt MoMo.',
    ],
    workflow: [
      'Chọn hình thức muốn dùng.',
      'Nhập đủ thông tin bắt buộc của hình thức đó.',
      'Bật phương thức lên rồi lưu.',
    ],
    concepts: [
      {
        term: 'Đã bật và Sẵn sàng',
        meaning:
          'Hai việc khác nhau. Một phương thức đã bật nhưng thiếu thông tin thì vẫn chưa dùng được. Hệ thống ghi rõ Needs setup khi còn thiếu.',
      },
      {
        term: 'Chuyển khoản thủ công và SePay',
        meaning:
          'Thủ công là bạn tự đối chiếu rồi xác nhận từng đơn. SePay là hệ thống nhận xác nhận tự động từ SePay.',
      },
    ],
    limits: [
      'Khi đổi giữa thủ công và SePay, thông tin đã lưu của hình thức cũ sẽ bị thay thế. Hệ thống hỏi lại trước khi đổi.',
      'Với MoMo, hệ thống không hiển thị trạng thái sẵn sàng vì phụ thuộc cấu hình chung của nền tảng.',
      'Cấu hình đầy đủ không có nghĩa là tiền đã về tài khoản của bạn.',
    ],
  },
  {
    id: 'van-hanh-thanh-toan',
    title: 'Vận hành thanh toán',
    route: '/tenant-admin/payment-operations',
    purpose: 'Xem tình trạng thanh toán của toàn bộ đơn và các trường hợp cần người xem lại.',
    canDo: [
      'Xem số lượng thanh toán theo từng trạng thái.',
      'Lọc theo phương thức, trạng thái, và tìm theo mã đơn hoặc liên hệ của khách.',
      'Xem danh sách cần xem lại kèm lý do cụ thể.',
      'Xem các lần hệ thống từ chối thông báo thanh toán.',
      'Mở đơn liên quan để xử lý tiếp.',
    ],
    workflow: [
      'Xem ô Needs review trước, vì đó là các trường hợp cần quyết định.',
      'Đọc lý do rồi bấm mở đơn.',
      'Với đơn chuyển khoản thủ công, xác nhận đã nhận tiền ngay trong trang đơn.',
    ],
    concepts: [
      {
        term: 'Các trạng thái',
        meaning:
          'Chờ thanh toán, đã thanh toán, thất bại, hết hạn và đã huỷ. Mỗi trạng thái lấy trực tiếp từ dữ liệu đã lưu.',
      },
      {
        term: 'Cần xem lại',
        meaning:
          'Là khi hai dữ kiện mâu thuẫn nhau, ví dụ đơn đã huỷ nhưng thanh toán lại thành công, hoặc đơn đã hoàn tất nhưng chưa thanh toán.',
      },
      {
        term: 'Trả thiếu và trả thừa',
        meaning:
          'Khi ngân hàng báo số tiền không khớp, hệ thống từ chối và ghi lại bằng chứng. Việc này không làm đơn chuyển sang đã thanh toán.',
      },
    ],
    limits: [
      'Đây không phải phần mềm kế toán và không phải hệ thống đối soát ngân hàng.',
      'Hệ thống không nhìn thấy tài khoản ngân hàng của bạn, nên không bao giờ khẳng định tiền đã về tài khoản.',
      'Các khoản chuyển tới mà hệ thống không xác định được là của cửa hàng nào sẽ không hiển thị ở đây, vì không thể đoán chủ sở hữu.',
      'Đơn COD luôn ở trạng thái chờ thanh toán cho tới khi bạn tự xử lý, vì hệ thống không ghi nhận việc thu tiền mặt.',
    ],
  },
  {
    id: 'chuyen-khoan',
    title: 'Thông tin chuyển khoản',
    route: '/tenant-admin/bank-transfer',
    purpose: 'Trang chỉ để xem, cho biết cấu hình chuyển khoản hiện tại của cửa hàng.',
    canDo: ['Xem trạng thái bật/tắt, mức độ sẵn sàng và hình thức đang dùng.'],
    workflow: [
      'Mở trang để kiểm tra nhanh cấu hình.',
      'Bấm sang trang Phương thức thanh toán nếu cần sửa.',
    ],
    concepts: [
      {
        term: 'Chỉ để xem',
        meaning:
          'Việc sửa thông tin ngân hàng làm ở một nơi duy nhất là trang Phương thức thanh toán, để hai nơi không bao giờ lệch nhau.',
      },
    ],
    limits: [
      'Không sửa được gì trên trang này.',
      'Thông tin ngân hàng mà khách nhìn thấy khi thanh toán được lấy từ trang Phương thức thanh toán.',
    ],
  },
  {
    id: 'van-chuyen',
    title: 'Vận chuyển',
    route: '/tenant-admin/shipping',
    purpose: 'Khai báo các phương thức giao hàng và mức phí mà khách thấy khi đặt đơn.',
    canDo: [
      'Thêm phương thức giao hàng với tên và mức phí.',
      'Bật hoặc tắt từng phương thức.',
      'Chọn một phương thức làm mặc định.',
      'Xoá phương thức không dùng nữa.',
    ],
    workflow: [
      'Thêm ít nhất một phương thức.',
      'Bật phương thức đó lên.',
      'Chọn phương thức hay dùng nhất làm mặc định.',
    ],
    concepts: [
      {
        term: 'Mặc định',
        meaning:
          'Phương thức được chọn sẵn khi khách thanh toán. Chỉ một phương thức được làm mặc định.',
      },
      { term: 'Phí bằng 0', meaning: 'Ghi số 0 nghĩa là miễn phí vận chuyển.' },
    ],
    limits: [
      'Nếu không có phương thức nào, hoặc tất cả đều đang tắt, khách sẽ không đặt hàng được. Hệ thống cảnh báo rõ trên trang này.',
      'Hệ thống không kết nối với đơn vị vận chuyển nào: không có mã vận đơn, không có trạng thái giao hàng, không in được vận đơn, không có dự kiến thời gian giao.',
      'Xoá một phương thức không ảnh hưởng tới đơn cũ, vì đơn đã lưu lại tên và phí tại thời điểm đặt.',
    ],
  },
];
